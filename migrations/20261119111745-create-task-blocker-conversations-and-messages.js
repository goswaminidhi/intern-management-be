'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    // 1. Create TaskBlockerConversations
    await queryInterface.createTable('TaskBlockerConversations', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },

      taskId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'tasks',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },

      menteeId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },

      mentorId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },

      status: {
        type: DataTypes.ENUM('open', 'resolved'),
        allowNull: false,
        defaultValue: 'open',
      },

      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },

      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });

    // 2. Create TaskBlockerMessages
    await queryInterface.createTable('TaskBlockerMessages', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },

      conversationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'TaskBlockerConversations',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },

      senderId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },

      message: {
        type: DataTypes.TEXT,
        allowNull: false,
      },

      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    });

    // 3. Add indexes
    await queryInterface.addIndex(
      'TaskBlockerConversations',
      ['taskId'],
      {
        name: 'task_blocker_conversations_task_id_idx',
      }
    );

    await queryInterface.addIndex(
      'TaskBlockerConversations',
      ['menteeId', 'mentorId', 'status'],
      {
        name: 'task_blocker_conversations_participants_status_idx',
      }
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('TaskBlockerMessages');

    await queryInterface.dropTable('TaskBlockerConversations');

    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_TaskBlockerConversations_status";'
    );
  },
};