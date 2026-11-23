'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE "users"
      ALTER COLUMN "assignedMentees" TYPE jsonb
      USING (
        CASE
          WHEN "assignedMentees" IS NULL OR btrim("assignedMentees") = '' THEN '[]'::jsonb
          WHEN left(btrim("assignedMentees"), 1) = '[' THEN "assignedMentees"::jsonb
          ELSE '[]'::jsonb
        END
      );
    `);

    await queryInterface.sequelize.query(`
      UPDATE "users" SET "assignedMentees" = '[]'::jsonb WHERE "assignedMentees" IS NULL;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE "users" ALTER COLUMN "assignedMentees" SET DEFAULT '[]'::jsonb;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE "users" ALTER COLUMN "assignedMentees" SET NOT NULL;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE "users" ALTER COLUMN "assigned_to" DROP DEFAULT;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE "users" ALTER COLUMN "assigned_to" SET DEFAULT 'admin';
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE "users" ALTER COLUMN "assignedMentees" DROP NOT NULL;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE "users" ALTER COLUMN "assignedMentees" DROP DEFAULT;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE "users"
      ALTER COLUMN "assignedMentees" TYPE varchar(255)
      USING "assignedMentees"::text;
    `);
  },
};

