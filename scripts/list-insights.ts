import prisma from "../src/lib/prisma";

async function main() {
  const posts = await prisma.insightPost.findMany({
    select: {
      id: true,
      title: true,
      slug: true,
      publishedAt: true,
      source: true,
      status: true,
    },
    orderBy: {
      publishedAt: 'desc',
    }
  });
  console.log(JSON.stringify(posts, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
