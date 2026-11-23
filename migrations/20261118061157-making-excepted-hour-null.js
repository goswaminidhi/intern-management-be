'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.changeColumn('tasks', 'estimated_hours', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      'UPDATE tasks SET estimated_hours = 1 WHERE estimated_hours IS NULL'
    )
  }
};
