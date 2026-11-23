'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
   await queryInterface.createTable('task_submissions', {
        id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },

    taskId: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: {
        model: 'tasks',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    },

    submittedBy: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    },

    version: {
      type: Sequelize.INTEGER,
      allowNull: false
    },

    submissionText: {
      type: Sequelize.TEXT,
      allowNull: false
    },

    attachmentUrl: {
      type: Sequelize.STRING,
      allowNull: true
    },

    status: {
      type: Sequelize.ENUM(
        'submitted',
        'changes_requested',
        'approved'
      ),
      allowNull: false,
      defaultValue: 'submitted'
    },

    mentorFeedback: {
      type: Sequelize.TEXT,
      allowNull: true
    },

    reviewedBy: {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    },

    reviewedAt: {
      type: Sequelize.DATE,
      allowNull: true
    },

    createdAt: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
    },

    updatedAt: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
    }
  });

await queryInterface.addIndex(
  'task_submissions',
  ['taskId', 'version'],
  {
    unique: true,
    name: 'unique_task_submission_version'
  }
);
  
},


  async down (queryInterface, Sequelize) {
   await queryInterface.dropTable('task_submissions');

await queryInterface.sequelize.query(
  'DROP TYPE IF EXISTS "enum_task_submissions_status";'
);
  }
};
