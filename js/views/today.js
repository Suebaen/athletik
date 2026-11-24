import { renderDay } from './day.js';

export function renderToday(ctx) {
  return renderDay(ctx, ctx.today(), { isToday: true });
}
