'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX "uniq_open_blocker_per_task_mentee"
      ON "TaskBlockerConversations" ("taskId", "menteeId")
      WHERE "status" = 'open';
    `);
    await queryInterface.addIndex(
      'TaskBlockerMessages',
      ['conversationId', 'createdAt'],
      { name: 'task_blocker_messages_conversation_created_idx' }
    );
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeIndex(
      'TaskBlockerMessages',
      'task_blocker_messages_conversation_created_idx'
    );
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS "uniq_open_blocker_per_task_mentee";'
    );
  }
};
