'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.renameColumn(
      'users',
      'assigned_mentees',
      'assignedMentees'
    );
  },

  async down (queryInterface, Sequelize) {
     await queryInterface.renameColumn(
      'users',
      'assignedMentees',
      'assigned_mentees'
    );
  }
};
