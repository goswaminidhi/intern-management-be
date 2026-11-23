// controllers/timeLogController.ts
import { Request, Response, NextFunction } from 'express';
import Task from '../models/tasks';
import * as svc from '../service/timeLogService'; // match your folder: 'service', not 'services'


export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const wrap =
  (fn: (req: Request, res: Response) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

export const startTimerController = wrap(async (req, res) => {
  const log = await svc.startTimer(Number(req.params.id), (req as any).user.id);
  res.status(201).json({ success: true, data: log });
});

export const getActiveTimerController = wrap(async (req, res) => {
  const data = await svc.getActiveTimer((req as any).user.id);
  res.json({ success: true, data }); // data is null when nothing is running
});

export const stopTimerController = wrap(async (req, res) => {
  const log = await svc.stopTimer(Number(req.params.id), (req as any).user.id, req.body?.note);
  res.json({ success: true, data: log });
});

export const getTaskTimeController = wrap(async (req, res) => {
  const user = (req as any).user;
  const task = await Task.findByPk(Number(req.params.id));
  if (!task) throw new HttpError(404, 'Task not found');

  const allowed =
    user.role === 'admin' ||
    task.mentee_id === user.id ||
    task.assigned_by === user.id;
  if (!allowed) throw new HttpError(403, 'Forbidden');

  res.json({ success: true, data: await svc.getTaskTimeSummary(task.id) });
});