'use strict';

/**
 * Makes tasks.estimated_hours optional (nullable).
 *
 * Uses raw SQL (PostgreSQL) so the column's existing type (INTEGER / DECIMAL /
 * FLOAT) is left untouched; only the NOT NULL constraint is dropped.
 *
 * !! Check TABLE below matches your real table name (see `tableName` in
 *    models/tasks). Sequelize usually pluralises: "tasks" or "Tasks".
 */
const TABLE = '"tasks"';
const COLUMN = '"estimated_hours"';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE ${TABLE} ALTER COLUMN ${COLUMN} DROP NOT NULL;`
    );
  },

  async down(queryInterface) {
    // Rows created without an estimate would block SET NOT NULL,
    // so give them a placeholder of 1 hour first.
    // (Lossy: you cannot tell afterwards which rows had no estimate.)
    await queryInterface.sequelize.query(
      `UPDATE ${TABLE} SET ${COLUMN} = 1 WHERE ${COLUMN} IS NULL;`
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE ${TABLE} ALTER COLUMN ${COLUMN} SET NOT NULL;`
    );
  },
};