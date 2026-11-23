'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
     await queryInterface.addColumn('tasks', 'due_reminder_sent', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },

  async down (queryInterface) {
    await queryInterface.removeColumn('tasks', 'due_reminder_sent');
  },
  
};
