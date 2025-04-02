import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Заглушка для тестирования
    const nftData = {
      name: body.name || "Rekt & Broke NFT",
      description: body.description || "Mint your 'Rekt & Broke' NFT on Base",
      image: body.image || "https://maroon-occupational-hoverfly-493.mypinata.cloud/ipfs/bafkreiaepcjam42w6hxqwza6f4ax7d4qumg4rfh3pv4euhdcurpliuz6bm",
    };

    return NextResponse.json({
      image: nftData.image,
      transactionHash: "0x1234567890abcdef", // Заглушка для хэша транзакции
      buttons: [{ label: "Mint Another NFT", action: "post" }],
    });
  } catch (error: any) {
    console.error("Error in API:", error);
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 });
  }
}