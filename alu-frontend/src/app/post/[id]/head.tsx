export default async function Head({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const base = (process.env.NEXT_PUBLIC_SITE_URL || 'https://alu-teal-pi.vercel.app').replace(/\/+$/, '');
  const url = `${base}/post/${id}`;

  return (
    <>
      <title>Post | alu</title>
      <meta name="description" content="View this post on alu." />
      <link rel="canonical" href={url} />
      <meta property="og:title" content="Post | alu" />
      <meta property="og:description" content="View this post on alu." />
      <meta property="og:url" content={url} />
      <meta property="og:type" content="article" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="Post | alu" />
      <meta name="twitter:description" content="View this post on alu." />
    </>
  );
}
