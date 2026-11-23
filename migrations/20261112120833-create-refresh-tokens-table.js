
"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // Create refresh_tokens table
    await queryInterface.createTable("refresh_tokens", {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },

      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },

      tokenHash: {
        type: Sequelize.STRING(64),
        allowNull: false,
        unique: true,
      },

      familyId: {
        type: Sequelize.STRING(36),
        allowNull: false,
      },

      expiresAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },

      revokedAt: {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
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

    // Add indexes for faster queries
    await queryInterface.addIndex("refresh_tokens", ["userId"]);
    await queryInterface.addIndex("refresh_tokens", ["familyId"]);
    await queryInterface.addIndex("refresh_tokens", ["expiresAt"]);
  },

  async down(queryInterface) {
    // Rollback: remove refresh_tokens table
    await queryInterface.dropTable("refresh_tokens");
  },
};
