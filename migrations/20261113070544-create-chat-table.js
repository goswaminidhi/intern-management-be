'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. chat_groups
    await queryInterface.createTable('chat_groups', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      name: { type: Sequelize.STRING(120), allowNull: false },
      description: { type: Sequelize.STRING(500), allowNull: true },
      taskId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'tasks', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      createdBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'active' },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('chat_groups', ['taskId']);

    // 2. chat_members
    await queryInterface.createTable('chat_members', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      groupId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'chat_groups', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      role: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'member' },
      joinedAt: { type: Sequelize.DATE, allowNull: false },
      leftAt: { type: Sequelize.DATE, allowNull: true },
      leftReason: { type: Sequelize.STRING(30), allowNull: true },
      lastReadMessageId: { type: Sequelize.INTEGER, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('chat_members', ['groupId', 'userId'], { unique: true });
    await queryInterface.addIndex('chat_members', ['userId']);

    // 3. chat_messages
    await queryInterface.createTable('chat_messages', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      groupId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'chat_groups', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      senderId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      senderName: { type: Sequelize.STRING(120), allowNull: false },
      type: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'text' },
      body: { type: Sequelize.TEXT, allowNull: true },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
      deletedBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('chat_messages', ['groupId', 'id']);

    // 4. chat_attachments
    await queryInterface.createTable('chat_attachments', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      messageId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'chat_messages', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      originalName: { type: Sequelize.STRING(255), allowNull: true },
      storedName: { type: Sequelize.STRING(100), allowNull: false },
      mimeType: { type: Sequelize.STRING(100), allowNull: false },
      size: { type: Sequelize.INTEGER, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('chat_attachments', ['messageId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('chat_attachments');
    await queryInterface.dropTable('chat_messages');
    await queryInterface.dropTable('chat_members');
    await queryInterface.dropTable('chat_groups');
  },
};