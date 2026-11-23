'use strict';

const { type } = require('node:os');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('users','assigned_mentees',{
      type:Sequelize.STRING,
      allowNull: true
    })
  },

  async down (queryInterface) {
    await queryInterface.removeColumn('users', 'assigned_mentees');
  }
};
