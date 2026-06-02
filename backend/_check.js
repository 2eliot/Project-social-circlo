const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const users = await p.user.count();
  const groups = await p.group.count();
  const channels = await p.channel.count();
  const messages = await p.message.count();
  const posts = await p.feed_posts.count();
  const dms = await p.directConversation.count();
  console.log({ users, groups, channels, messages, posts, dms });
  await p.$disconnect();
})();
