'use strict';
const { DataTypes } = require('sequelize');
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
     await queryInterface.addColumn('task_submissions', 'submissionUrl', {
      type: DataTypes.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('task_submissions', 'demoUrl', {
      type: DataTypes.STRING,
      allowNull: true,
    });
  },

  async down (queryInterface, Sequelize) {
   await queryInterface.removeColumn('task_submissions', 'demoUrl');
    await queryInterface.removeColumn('task_submissions', 'submissionUrl');

  }
};
