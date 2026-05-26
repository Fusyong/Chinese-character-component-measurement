import type { PathCommand } from 'opentype.js';

/** 按每个 Z 命令切分为独立闭合轮廓。 */
export function splitContours(commands: PathCommand[]): PathCommand[][] {
  const contours: PathCommand[][] = [];
  let current: PathCommand[] = [];

  for (const cmd of commands) {
    current.push(cmd);
    if (cmd.type === 'Z') {
      if (current.length > 0) {
        contours.push(current);
        current = [];
      }
    }
  }

  if (current.length > 0) contours.push(current);
  return contours;
}
