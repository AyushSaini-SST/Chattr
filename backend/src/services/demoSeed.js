import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { Post } from '../models/Post.js';

const people = [
  { username: 'maya.chen', email: 'maya.chen@demo.chattr.invalid', displayName: 'Maya Chen', bio: 'Collecting small moments and big ideas.', headline: 'Design student' },
  { username: 'leo.parker', email: 'leo.parker@demo.chattr.invalid', displayName: 'Leo Parker', bio: 'Coffee, code, and long walks home.', headline: 'Computer science student' },
  { username: 'amara.jones', email: 'amara.jones@demo.chattr.invalid', displayName: 'Amara Jones', bio: 'Making room for curiosity.', headline: 'Writer & reader' },
  { username: 'noah.kim', email: 'noah.kim@demo.chattr.invalid', displayName: 'Noah Kim', bio: 'Learning something new every day.', headline: 'Community builder' },
];

const posts = [
  { author: 'maya.chen', text: 'A tiny reminder from today: the best ideas usually show up after you give yourself a little room to wander. #creativity', likes: ['leo.parker', 'amara.jones', 'noah.kim'], comments: [['leo.parker', 'Needed this reminder today.'], ['amara.jones', 'A walk with no destination is underrated.']] },
  { author: 'leo.parker', text: 'Finally got my little study corner set up. Nothing fancy, just a lamp, a notebook, and a playlist that makes the hard problems feel possible. #studentlife', likes: ['maya.chen', 'noah.kim'], comments: [['maya.chen', 'The right playlist makes all the difference!']] },
  { author: 'amara.jones', text: 'Current reading rule: if a sentence makes you stop and reread it, write it down. Future you will be glad. #reading', likes: ['maya.chen', 'leo.parker', 'noah.kim'], comments: [['noah.kim', 'Starting a notebook for this.'], ['maya.chen', 'Please share your favorite lines sometime!']] },
  { author: 'noah.kim', text: 'What is one small thing someone did for you recently that made your week better? I am collecting good-news moments. #community', likes: ['amara.jones'], comments: [['amara.jones', 'A friend remembered how I take my tea. Small thing, huge smile.']] },
];

// Populate a shared public starter feed once per database. Demo credentials are
// intentionally random so these sample profiles cannot be used to sign in.
export async function seedDemoContent() {
  const users = new Map();
  for (const person of people) {
    let user = await User.findOne({ username: person.username });
    if (!user) {
      const passwordHash = await bcrypt.hash(randomBytes(48).toString('hex'), 10);
      user = await User.create({ ...person, passwordHash, messagePreference: 'nobody' });
    }
    users.set(person.username, user);
  }

  for (const item of posts) {
    const author = users.get(item.author);
    const exists = await Post.exists({ author: author._id, text: item.text });
    if (exists) continue;
    await Post.create({
      author: author._id,
      text: item.text,
      visibility: 'public',
      likes: item.likes.map((username) => users.get(username)._id),
      comments: item.comments.map(([username, text]) => ({ author: users.get(username)._id, text })),
    });
  }
}
