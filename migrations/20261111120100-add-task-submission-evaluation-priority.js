'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_tasks_status" ADD VALUE IF NOT EXISTS 'submitted';
    `);
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_tasks_status" ADD VALUE IF NOT EXISTS 'needs-revision';
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'in-progress';
    `);

    await queryInterface.sequelize.query(`
      UPDATE "tasks" SET "category" = 'upskill' WHERE "category" IS NULL;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE "tasks" ALTER COLUMN "category" SET NOT NULL;
    `);

    await queryInterface.addColumn('tasks', 'priority', {
      type: Sequelize.ENUM('low', 'medium', 'high'),
      allowNull: false,
      defaultValue: 'medium',
    });

    await queryInterface.addColumn('tasks', 'submission_url', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('tasks', 'demo_url', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('tasks', 'submission_notes', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    await queryInterface.addColumn('tasks', 'submitted_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addColumn('tasks', 'score', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });

    await queryInterface.addColumn('tasks', 'feedback', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    await queryInterface.addColumn('tasks', 'evaluated_by', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await queryInterface.addColumn('tasks', 'evaluated_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE "tasks"
      ADD CONSTRAINT "tasks_score_range"
      CHECK (score IS NULL OR (score >= 0 AND score <= 100));
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_score_range";
    `);
    await queryInterface.removeColumn('tasks', 'evaluated_at');
    await queryInterface.removeColumn('tasks', 'evaluated_by');
    await queryInterface.removeColumn('tasks', 'feedback');
    await queryInterface.removeColumn('tasks', 'score');
    await queryInterface.removeColumn('tasks', 'submitted_at');
    await queryInterface.removeColumn('tasks', 'submission_notes');
    await queryInterface.removeColumn('tasks', 'demo_url');
    await queryInterface.removeColumn('tasks', 'submission_url');
    await queryInterface.removeColumn('tasks', 'priority');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_tasks_priority";');
    await queryInterface.sequelize.query(`
      ALTER TABLE "tasks" ALTER COLUMN "category" DROP NOT NULL;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE "tasks" ALTER COLUMN "status" DROP DEFAULT;
    `);
  },
};

