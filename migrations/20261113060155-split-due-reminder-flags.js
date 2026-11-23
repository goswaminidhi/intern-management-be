'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const columns = await queryInterface.describeTable('tasks');

      await queryInterface.addColumn(
        'tasks',
        'due_reminder_24h_sent',
        { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        { transaction }
      );

      await queryInterface.addColumn(
        'tasks',
        'due_reminder_1h_sent',
        { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        { transaction }
      );

      // Keep the history: a reminder already sent under the old flag counts as the 24h one
      if (columns.due_reminder_sent) {
        await queryInterface.sequelize.query(
          'UPDATE tasks SET due_reminder_24h_sent = due_reminder_sent',
          { transaction }
        );
        await queryInterface.removeColumn('tasks', 'due_reminder_sent', { transaction });
      }
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'tasks',
        'due_reminder_sent',
        { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        { transaction }
      );

      await queryInterface.sequelize.query(
        'UPDATE tasks SET due_reminder_sent = due_reminder_24h_sent',
        { transaction }
      );

      await queryInterface.removeColumn('tasks', 'due_reminder_24h_sent', { transaction });
      await queryInterface.removeColumn('tasks', 'due_reminder_1h_sent', { transaction });
    });
  }
  
};
