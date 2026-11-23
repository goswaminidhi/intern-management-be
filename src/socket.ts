import { Server } from "socket.io";
import type { Server as HttpServer } from "node:http";

import { verifyJwt } from "./middleware/authMiddleware";
import User from "./models/user";
import { ChatMember } from "./models/chat";

// --------------------------------------------------
// INTERFACES
// --------------------------------------------------

interface SocketUser {
  id: number;
  role: string;
  name: string;
}

interface SocketData {
  user: SocketUser;
  activeGroupId?: number | null;
}

// --------------------------------------------------
// SOCKET.IO SERVER
// --------------------------------------------------

let io: Server<any, any, any, SocketData> | null = null;

// --------------------------------------------------
// ROOM NAMES
// --------------------------------------------------

// Personal room for notifications
export const userRoom = (userId: number) => `user:${userId}`;

// Group room for actual chat messages
export const groupRoom = (groupId: number) => `group:${groupId}`;

// Separate room for users currently viewing a group
export const viewingGroupRoom = (groupId: number) =>
  `viewing-group:${groupId}`;

// --------------------------------------------------
// INITIALIZE SOCKET.IO
// --------------------------------------------------

export function initSocket(
  httpServer: HttpServer,
  allowedOrigins: string[]
) {
  io = new Server<any, any, any, SocketData>(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
  });

  // --------------------------------------------------
  // SOCKET AUTHENTICATION
  // --------------------------------------------------

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;

    if (!token) {
      return next(new Error("Unauthorized: no token"));
    }

    try {
      const payload = verifyJwt(token);

      const user = await User.findByPk(payload.id, {
        attributes: ["id", "name", "role", "status"],
      });

      if (!user) {
        return next(new Error("Unauthorized: user not found"));
      }

      if (user.status !== "active") {
        return next(new Error("Unauthorized: account deactivated"));
      }

      socket.data.user = {
        id: user.id,
        role: user.role,
        name: user.name,
      };

      next();
    } catch (error) {
      if (
        (error as { name?: string })?.name === "TokenExpiredError"
      ) {
        return next(new Error("TOKEN_EXPIRED"));
      }

      next(new Error("Unauthorized: invalid or expired token"));
    }
  });

  // --------------------------------------------------
  // SOCKET CONNECTION
  // --------------------------------------------------

  io.on("connection", async (socket) => {
    const { id, role, name } = socket.data.user;

    console.log(
      `Socket connected: user ${id} (${socket.id})`
    );

    // --------------------------------------------------
    // 1. JOIN PERSONAL AND ROLE ROOMS
    // --------------------------------------------------

    socket.join(userRoom(id));
    socket.join(`role:${role}`);

    // --------------------------------------------------
    // 2. TYPING INDICATOR
    // --------------------------------------------------

    socket.on(
      "typing",
      (payload: { groupId?: number }) => {
        const groupId = Number(payload?.groupId);

        if (!Number.isInteger(groupId) || groupId <= 0) {
          return;
        }

        // Only active group members can send typing events
        if (!socket.rooms.has(groupRoom(groupId))) {
          return;
        }

        socket.to(groupRoom(groupId)).emit("typing", {
          groupId,
          userId: id,
          name,
        });
      }
    );

    // --------------------------------------------------
    // 3. TRACK CURRENTLY VIEWED GROUP
    // --------------------------------------------------

    socket.on(
      "chat:active",
      async (payload: { groupId?: number }) => {
        try {
          const groupId = Number(payload?.groupId);

          if (!Number.isInteger(groupId) || groupId <= 0) {
            return;
          }

          // Verify that the user is an active member or an admin
          const membership = await ChatMember.findOne({
            where: {
              groupId,
              userId: id,
              leftAt: null,
            },
          });

          if (!membership && role !== "admin") {
            return;
          }

          const previousGroupId = socket.data.activeGroupId;

          // Leave the previously viewed group
          if (
            previousGroupId &&
            previousGroupId !== groupId
          ) {
            await socket.leave(
              viewingGroupRoom(previousGroupId)
            );
            if (role === "admin") {
              const wasMember = await ChatMember.findOne({
                where: { groupId: previousGroupId, userId: id, leftAt: null },
              });
              if (!wasMember) {
                await socket.leave(groupRoom(previousGroupId));
              }
            }
          }

          // Join the currently viewed group
          await socket.join(
            viewingGroupRoom(groupId)
          );

          if (role === "admin") {
            await socket.join(groupRoom(groupId));
          }

          socket.data.activeGroupId = groupId;

          console.log(
            `User ${id} is viewing group ${groupId}`
          );
        } catch (error) {
          console.error(
            "Failed to update active chat group:",
            error
          );
        }
      }
    );

    // --------------------------------------------------
    // 4. STOP TRACKING VIEWED GROUP
    // --------------------------------------------------

    socket.on("chat:inactive", async () => {
      try {
        const activeGroupId = socket.data.activeGroupId;

        if (!activeGroupId) {
          return;
        }

        await socket.leave(
          viewingGroupRoom(activeGroupId)
        );

        if (role === "admin") {
          const wasMember = await ChatMember.findOne({
            where: { groupId: activeGroupId, userId: id, leftAt: null },
          });
          if (!wasMember) {
            await socket.leave(groupRoom(activeGroupId));
          }
        }

        socket.data.activeGroupId = null;

        console.log(
          `User ${id} stopped viewing group ${activeGroupId}`
        );
      } catch (error) {
        console.error(
          "Failed to leave viewing group:",
          error
        );
      }
    });

    // --------------------------------------------------
    // 5. JOIN ALL ACTIVE CHAT GROUPS
    // --------------------------------------------------

    try {
      const memberships = await ChatMember.findAll({
        where: {
          userId: id,
          leftAt: null,
        },
        attributes: ["groupId"],
      });

      await Promise.all(
        memberships.map((membership) =>
          socket.join(
            groupRoom(membership.groupId)
          )
        )
      );

      console.log(
        `User ${id} joined ${memberships.length} chat groups`
      );
    } catch (error) {
      console.error(
        `Failed to join chat rooms for user ${id}:`,
        error
      );
    }

    // --------------------------------------------------
    // 6. DISCONNECT
    // --------------------------------------------------

    socket.on("disconnect", () => {
      console.log(
        `Socket disconnected: user ${id} (${socket.id})`
      );

      // Socket.IO automatically removes the disconnected
      // socket from all rooms.
    });
  });

  return io;
}

// --------------------------------------------------
// GET SOCKET.IO INSTANCE
// --------------------------------------------------

export function getIO() {
  if (!io) {
    throw new Error("Socket.IO not initialised");
  }

  return io;
}

// --------------------------------------------------
// EMIT CHAT MESSAGE TO GROUP
// --------------------------------------------------

export function emitToGroup(
  groupId: number,
  event: string,
  payload: unknown
): void {
  io?.to(groupRoom(groupId)).emit(event, payload);
}

// --------------------------------------------------
// EMIT NOTIFICATION TO USER
// --------------------------------------------------

export function emitToUser(
  userId: number,
  event: string,
  payload: unknown
): void {
  io?.to(userRoom(userId)).emit(event, payload);
}

// --------------------------------------------------
// ADD USER TO GROUP ROOM
// --------------------------------------------------

export function addUserToGroupRoom(
  userId: number,
  groupId: number
): void {
  io
    ?.in(userRoom(userId))
    .socketsJoin(groupRoom(groupId));
}

// --------------------------------------------------
// REMOVE USER FROM GROUP ROOM
// --------------------------------------------------

export function removeUserFromGroupRoom(
  userId: number,
  groupId: number
): void {
  io
    ?.in(userRoom(userId))
    .socketsLeave(groupRoom(groupId));
}

// --------------------------------------------------
// DISCONNECT ALL USER SOCKETS
// --------------------------------------------------

export function disconnectUser(
  userId: number
): void {
  io
    ?.in(userRoom(userId))
    .disconnectSockets(true);
}

// --------------------------------------------------
// GET USERS CURRENTLY VIEWING A GROUP
// --------------------------------------------------

export async function getUsersViewingGroup(
  groupId: number
): Promise<Set<number>> {
  if (!io) {
    return new Set<number>();
  }

  const sockets = await io
    .in(viewingGroupRoom(groupId))
    .fetchSockets();

  const viewingUserIds = new Set<number>();

  for (const socket of sockets) {
    const userId = Number(socket.data.user?.id);

    if (Number.isInteger(userId)) {
      viewingUserIds.add(userId);
    }
  }

  return viewingUserIds;
}