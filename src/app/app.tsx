"use client";

import dynamic from "next/dynamic";

const MintNft = dynamic(() => import("~/components/mint-nft"), {
  ssr: false,
});

export default function App(
  { title }: { title?: string } = { title: "Mint Your NFT" }
) {
  return <MintNft />;
}
