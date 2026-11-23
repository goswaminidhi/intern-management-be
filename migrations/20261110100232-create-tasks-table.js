'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
   await queryInterface.createTable('tasks', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      title: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      category: {
        type: Sequelize.ENUM('upskill','research','client-project','inhouse-project'),
        allowNull: true,
        defaultValue: 'upskill',
      },
      start_date: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      due_date: {
        type: Sequelize.DATE,
        allowNull: false
      },
      estimated_hours: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      mentee_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      assigned_by: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      status: {
        type: Sequelize.ENUM('in-progress','complete','hold'),
        allowNull: false,
      },
       created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      }
    });
      await queryInterface.sequelize.query(
      'ALTER TABLE "tasks" ADD CONSTRAINT "tasks_due_after_start" CHECK (due_date >= start_date);'
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE "tasks" ADD CONSTRAINT "tasks_hours_positive" CHECK (estimated_hours > 0);'
    );

    await queryInterface.addIndex('tasks', ['mentee_id', 'status']);
    await queryInterface.addIndex('tasks', ['assigned_by']);
    await queryInterface.addIndex('tasks', ['due_date']);
  },


  async down (queryInterface, Sequelize) {
    await queryInterface.dropTable('tasks');
    // PostgreSQL keeps ENUM types after the table is dropped, so remove them too
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_tasks_category";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_tasks_status";');
  }
};
