'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Add ImageKit fileId column
    await queryInterface.addColumn('chat_attachments', 'fileId', {
      type: Sequelize.STRING(100),
      allowNull: true,
    });

    // 2. Add ImageKit direct CDN URL column
    await queryInterface.addColumn('chat_attachments', 'url', {
      type: Sequelize.STRING(1000),
      allowNull: true,
    });

    // 3. Allow storedName to be nullable (since cloud files don't use local disk names)
    await queryInterface.changeColumn('chat_attachments', 'storedName', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('chat_attachments', 'fileId');
    await queryInterface.removeColumn('chat_attachments', 'url');
    await queryInterface.changeColumn('chat_attachments', 'storedName', {
      type: Sequelize.STRING(100),
      allowNull: false,
    });
  },
};