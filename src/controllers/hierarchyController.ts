// controllers/hierarchyController.ts
import { Request, Response } from 'express';
import User from '../../src/models/user';

export const getHierarchy = async (req: Request, res: Response) => {
  try {
    const admins = await User.findAll({
      where: { role: 'admin' },
      attributes: ['id', 'name', 'email', 'role', 'status'],
    });

    const mentors = await User.findAll({
      where: { role: 'mentor' },
      attributes: ['id', 'name', 'email', 'role', 'status'],
      include: [
        {
          model: User,
          as: 'mentees',
          attributes: ['id', 'name', 'email', 'role', 'status'],
        },
      ],
      order: [['name', 'ASC']],
    });

    // All mentors go under admin(s)
    const tree = admins.map((admin) => ({
      ...admin.toJSON(),
      children: mentors.map((m) => {
        const { mentees, ...mentor } = m.toJSON() as any;
        return { ...mentor, children: mentees ?? [] };
      }),
    }));

    res.json(tree);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch hierarchy' });
  }
};