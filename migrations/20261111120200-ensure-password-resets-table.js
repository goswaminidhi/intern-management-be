'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const normalizedTables = tables.map((t) =>
      typeof t === 'string' ? t : t.tableName
    );
    if (normalizedTables.includes('password_resets')) {
      return;
    }

    await queryInterface.createTable('password_resets', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      otpHash: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      expiresAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      attempts: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      verifiedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      resetTokenHash: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      resetTokenExpiresAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      usedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('password_resets', ['userId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('password_resets');
  },
};

