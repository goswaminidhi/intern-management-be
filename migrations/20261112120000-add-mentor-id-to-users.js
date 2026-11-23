'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('users');

    if (!tableDesc.mentor_id) {
      await queryInterface.addColumn('users', 'mentor_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: null,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });
    }

    const existingIndexes = await queryInterface.showIndex('users');
    const hasMentorIdIndex = existingIndexes.some(
      (idx) => idx.name === 'users_mentor_id_idx'
    );
    if (!hasMentorIdIndex) {
      await queryInterface.addIndex('users', ['mentor_id'], {
        name: 'users_mentor_id_idx',
      });
    }

    // Backfill mentor_id on existing mentees using Sequelize ORM
    const UserMigrationModel = queryInterface.sequelize.define(
      'UserMigration',
      {
        id: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        name: Sequelize.STRING,
        role: Sequelize.STRING,
        assigned_to: Sequelize.STRING,
        assignedMentees: Sequelize.JSONB,
        mentor_id: Sequelize.INTEGER,
      },
      {
        tableName: 'users',
        timestamps: false,
      }
    );

    const transaction = await queryInterface.sequelize.transaction();
    try {
      const mentors = await UserMigrationModel.findAll({
        where: { role: 'mentor' },
        transaction,
      });
      const mentees = await UserMigrationModel.findAll({
        where: { role: 'mentee' },
        transaction,
      });

      const mentorByLowerName = new Map();
      const mentorByMenteeId = new Map();

      for (const mentor of mentors) {
        const lowerName = (mentor.name || '').trim().toLowerCase();
        if (lowerName && !mentorByLowerName.has(lowerName)) {
          mentorByLowerName.set(lowerName, mentor);
        }
        const ids = Array.isArray(mentor.assignedMentees)
          ? mentor.assignedMentees.map(Number).filter((n) => Number.isInteger(n) && n > 0)
          : [];
        for (const mid of ids) {
          if (!mentorByMenteeId.has(mid)) {
            mentorByMenteeId.set(mid, mentor);
          }
        }
      }

      const syncedMenteesByMentorId = new Map();
      for (const mentor of mentors) {
        syncedMenteesByMentorId.set(mentor.id, new Set());
      }

      for (const mentee of mentees) {
        const assignedLower = (mentee.assigned_to || '').trim().toLowerCase();
        const isSentinel =
          !assignedLower ||
          assignedLower === 'admin' ||
          assignedLower === 'unassigned' ||
          assignedLower === 'null';

        const resolvedMentor =
          (!isSentinel ? mentorByLowerName.get(assignedLower) : null) ||
          mentorByMenteeId.get(mentee.id) ||
          null;

        const nextMentorId = resolvedMentor ? resolvedMentor.id : null;
        const nextAssignedTo = resolvedMentor ? resolvedMentor.name : null;

        if (resolvedMentor) {
          syncedMenteesByMentorId.get(resolvedMentor.id).add(mentee.id);
        }

        if (mentee.mentor_id !== nextMentorId || mentee.assigned_to !== nextAssignedTo) {
          await mentee.update(
            { mentor_id: nextMentorId, assigned_to: nextAssignedTo },
            { transaction }
          );
        }
      }

      for (const mentor of mentors) {
        const normalizedIds = Array.from(syncedMenteesByMentorId.get(mentor.id) || []).sort(
          (a, b) => a - b
        );
        await mentor.update({ assignedMentees: normalizedIds }, { transaction });
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const existingIndexes = await queryInterface.showIndex('users');
    if (existingIndexes.some((idx) => idx.name === 'users_mentor_id_idx')) {
      await queryInterface.removeIndex('users', 'users_mentor_id_idx');
    }

    const tableDesc = await queryInterface.describeTable('users');
    if (tableDesc.mentor_id) {
      await queryInterface.removeColumn('users', 'mentor_id');
    }
  },
};

