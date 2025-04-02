import { Metadata } from "next";

const appUrl = process.env.NEXT_PUBLIC_URL || "http://localhost:3000";
const apiUrl = `${appUrl}/api/mint-nft`;

const frame = {
  version: "vNext",
  image: `https://via.placeholder.com/1200x630.png?text=Mint+Your+NFT`,
  button: {
    title: "Mint NFT",
    action: {
      type: "post",
    },
  },
  post_url: apiUrl,
};

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Mint Your NFT",
    openGraph: {
      title: "Mint Your NFT",
      description: "Mint your NFT directly from this frame!",
    },
    other: {
      "fc:frame": JSON.stringify(frame),
    },
  };
}