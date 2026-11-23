'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface) {
    const table = await queryInterface.describeTable('users');
    if (table.raw_password) {
      await queryInterface.removeColumn('users', 'raw_password');
    }
  },

  async down (queryInterface, Sequelize) {
   await queryInterface.addColumn('users', 'raw_password', {
      type: Sequelize.STRING,
      allowNull: true,
    });
  }
};
