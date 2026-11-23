'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_mentee_id_fkey";
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE "tasks"
      ADD CONSTRAINT "tasks_mentee_id_fkey"
      FOREIGN KEY ("mentee_id")
      REFERENCES "users" ("id")
      ON UPDATE CASCADE
      ON DELETE CASCADE;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_mentee_id_fkey";
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE "tasks"
      ADD CONSTRAINT "tasks_mentee_id_fkey"
      FOREIGN KEY ("mentee_id")
      REFERENCES "users" ("id")
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
    `);
  },
};

