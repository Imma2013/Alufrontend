export default async function Head({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const base = (process.env.NEXT_PUBLIC_SITE_URL || 'https://alu-teal-pi.vercel.app').replace(/\/+$/, '');
  const url = `${base}/watch/${id}`;

  return (
    <>
      <title>Watch | alu</title>
      <meta name="description" content="Watch this video on alu." />
      <link rel="canonical" href={url} />
      <meta property="og:title" content="Watch | alu" />
      <meta property="og:description" content="Watch this video on alu." />
      <meta property="og:url" content={url} />
      <meta property="og:type" content="video.other" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="Watch | alu" />
      <meta name="twitter:description" content="Watch this video on alu." />
    </>
  );
}
