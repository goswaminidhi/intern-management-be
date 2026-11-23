'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DO $$
      DECLARE
        enum_type TEXT;
      BEGIN
        SELECT udt_name
        INTO enum_type
        FROM information_schema.columns
        WHERE table_name = 'tasks'
          AND column_name = 'status';

        IF enum_type IS NOT NULL THEN
          EXECUTE format(
            'ALTER TYPE %I ADD VALUE IF NOT EXISTS %L',
            enum_type,
            'blocker'
          );
        END IF;
      END $$;
    `);
  },

  async down (queryInterface, Sequelize) {
   
  }
};
