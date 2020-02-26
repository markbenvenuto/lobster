// @flow strict

import type { Log } from '../../models';
import resmokeTestEvents from './resmokeTestEvents';

function getGitVersion(line: string): string {
  const gitVersionStr = 'git version: ';
  const gitVersionPos = line.indexOf(gitVersionStr);
  if (gitVersionPos !== -1) {
    return line.substr(gitVersionPos + gitVersionStr.length);
  }
  return 'master';
}

function getFullGitRef(fileLine: ?string, gitVersion: string): ?string {
  if (!fileLine) {
    return null;
  }
  const gitPrefix = 'https://github.com/mongodb/mongo/blob/';
  return gitPrefix + gitVersion + '/' + fileLine;
}

function padEnd(str, len) {
  if(str.length < len) {
      return str + ' '.repeat(len - str.length );
  }
  return str;
}
class LogFormatter {

  // var LOG_FORMAT_PREFIX = '{"t":{"$date';
  // LOG_ERROR_REGEX = 'invariant|fassert|failed to load|uncaught exception';
  // LOG_ATTR_REGEX = '\{([\w]+)\}';

  constructor() {
      this.reAttr = /{(\w+)\}/g;
  }

  format_line(
      date,
      log_level,
      component,
      context,
      id,
      msg
  ) {
      return `${date} ${padEnd(log_level, 2)} ${padEnd(component,8)} [${context}] ${msg}`;
  }

  log_to_str(str) {

      let parsed = JSON.parse(str);

      let d = parsed["t"]["$date"];
      let log_level = parsed["s"]
      let component = parsed["c"];
      let log_id = parsed["id"];
      let context = parsed["ctx"];
      let msg = parsed["msg"];
      let attr = parsed["attr"];

      if (msg.indexOf("{") >= 0) {
          // Handle messages which are just an empty {}
          if (msg === "{}") {
              return this.format_line(
                  d,
                  log_level,
                  component,
                  context,
                  log_id,
                  attr["message"]);
          }


          let msg_fmt = msg.replace(this.reAttr, function replacer(match, capture1, offset, str) {
              
              // TODO - objs?
              // TODO - missing?
              let ret =  attr[capture1];
              if (typeof ret === 'object') {
                  return JSON.stringify(ret);
              }
              return ret; 
          });

          return this.format_line(
              d,
              log_level,
              component,
              context,
              log_id,
              msg_fmt
          );
      } else {
          if (attr !== undefined) {
              let s1 = msg + attr;
              return this.format_line(
                  d,
                  log_level,
                  component,
                  context,
                  log_id,
                  s1
              );
          }

          return this.format_line(
              d,
              log_level,
              component,
              context,
              log_id,
              msg
          );
      }
  }

  fuzzy_log_to_str(str) {
      const LOG_FORMAT_PREFIX = '{"t":{"$date';
      if (str.startsWith(LOG_FORMAT_PREFIX)) {
          return this.log_to_str(str);
      }

      // TODO - become stateful and rember where we found a previous start
      let pos = str.indexOf(LOG_FORMAT_PREFIX);
      if (pos !== -1) {
          return str.substring(0, pos) + this.log_to_str(str.substring(pos));
      }

      // We do not think it is a JSON log line, return it as is
      return str;
  }
}


export default function(state: Log, response: string): Log {
  // set the url to the url we requested
  let lines = response.split('\n');

  let linestr = "";
  const lf = new LogFormatter();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    linestr += lf.fuzzy_log_to_str(line);
    linestr += "\n";
  }

   lines = linestr.split('\n');

  const processed = [];
  const gitPrefix = '{githash:';
  const gitPrefixLen = gitPrefix.length + 2;
  let gitVersionStr: string = 'master';
  const portRegex = / [sdbc](\d{1,5})\|/;
  const stateRegex = /(:shard\d*|:configsvr)?:(initsync|primary|mongos|secondary\d*|node\d*)]/;

  const colorMap = {};

  const colorList = [
    '#5aae61',
    '#9970ab',
    '#bf812d',
    '#2166ac',
    '#8c510a',
    '#1b7837',
    '#74add1',
    '#d6604d',
    '#762a83',
    '#35978f',
    '#de77ae'
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Only check the git version if we haven't seen it so far.
    if (gitVersionStr === 'master') {
      gitVersionStr = getGitVersion(line);
    }

    let lineText = line;
    let gitRef: ?string = undefined;
    const gitStartIdx = line.indexOf(gitPrefix);
    if (gitStartIdx !== -1) {
      const gitStopIdx = line.indexOf('}', gitStartIdx);
      if (gitStopIdx > gitStartIdx + gitPrefixLen) {
        gitRef = line.substr(gitStartIdx + gitPrefixLen, gitStopIdx - (gitStartIdx + gitPrefixLen) - 1);
        lineText = line.substr(0, gitStartIdx - 1) + line.substr(gitStopIdx + 1);
      }
    }

    const portArray = portRegex.exec(line);
    let port = undefined;
    if (portArray) {
      port = portArray[1];
    } else {
      const stateArray = stateRegex.exec(line);
      if (stateArray) {
        port = stateArray[0];
      }
    }
    if (port && !colorMap[port]) {
      colorMap[port] = colorList[Object.keys(colorMap).length % colorList.length];
    }

    if (gitRef) {
      gitRef = getFullGitRef(gitRef, gitVersionStr);
    }

    processed.push({
      lineNumber: i,
      text: lineText,
      port: port,
      gitRef: gitRef
    });
  }
  // TODO: properly defer this in the cluster vis
  let events = [];
  /* global process:{} */
  if (process.env.NODE_ENV !== 'production') {
    events = resmokeTestEvents(processed);
  }
  return {
    identity: state.identity,
    lines: processed,
    colorMap: colorMap,
    isDone: true,
    events: events
  };
}
