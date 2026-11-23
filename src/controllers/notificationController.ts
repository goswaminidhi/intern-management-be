import type { Request, Response, NextFunction } from "express";
import * as service from "../service/notificationService";

export async function getNotifications(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const notifications = await service.listNotifications(req.user!.id, limit, offset);
    res.json(notifications);
  } catch (err) {
    next(err);
  }
}

export async function getUnreadCount(req: Request, res: Response, next: NextFunction) {
  try {
    const count = await service.getUnreadCount(req.user!.id);
    res.json({ count });
  } catch (err) {
    next(err);
  }
}

export async function markAsRead(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid notification id" });
    }

    const affected = await service.markRead(req.user!.id, id);
    if (affected === 0) {
      return res.status(404).json({ message: "Notification not found" });
    }

    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
}

export async function markAllAsRead(req: Request, res: Response, next: NextFunction) {
  try {
    await service.markAllRead(req.user!.id);
    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
}