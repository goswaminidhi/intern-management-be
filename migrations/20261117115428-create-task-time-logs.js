'use strict';

module.exports = {
  async up(q, Sequelize) {
    await q.createTable('task_time_logs', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      task_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'tasks', key: 'id' }, onDelete: 'CASCADE',
      },
      user_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'users', key: 'id' },
      },
      started_at: { type: Sequelize.DATE, allowNull: false },
      ended_at: { type: Sequelize.DATE, allowNull: true },
      duration_seconds: { type: Sequelize.INTEGER, allowNull: true },
      auto_closed: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      note: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await q.addIndex('task_time_logs', ['task_id']);
    await q.addIndex('task_time_logs', ['user_id', 'ended_at']);

    await q.addColumn('tasks', 'actual_seconds', {
      type: Sequelize.INTEGER, allowNull: false, defaultValue: 0,
    });
  },

  async down(q) {
    await q.removeColumn('tasks', 'actual_seconds');
    await q.dropTable('task_time_logs');
  },
};