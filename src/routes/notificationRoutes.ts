import { Router } from "express";
import * as controller from "../controllers/notificationController";

const router = Router();

router.get("/", controller.getNotifications);
router.get("/unread-count", controller.getUnreadCount);
router.patch("/read-all", controller.markAllAsRead);
router.patch("/:id/read", controller.markAsRead);

export default router;