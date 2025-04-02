"use client";

import { useState, useEffect, useCallback } from "react";
import { JsonRpcProvider, Contract, parseEther, formatEther, BrowserProvider } from "ethers";
import sdk, { type Context } from "@farcaster/frame-sdk";

const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
const abi = [
  "function mint() public payable",
  "function MINT_PRICE() public view returns (uint256)",
  "function MAX_SUPPLY() public view returns (uint256)",
  "function totalMinted() public view returns (uint256)",
];

// Публичный RPC для Base (используем для проверки транзакций)
const BASE_RPC_URL = "https://mainnet.base.org";

// Перечисление статусов транзакции
enum TxStatus {
  NONE = "None",
  PREPARING = "Preparing",
  AWAITING_APPROVAL = "Awaiting Approval",
  SUBMITTED = "Submitted",
  PENDING = "Pending",
  CONFIRMED = "Confirmed",
  FAILED = "Failed"
}

export default function MintNFT() {
  const [status, setStatus] = useState<TxStatus>(TxStatus.NONE);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [totalMinted, setTotalMinted] = useState<number>(0);
  const [maxSupply, setMaxSupply] = useState<number>(10000);
  const [mintPrice, setMintPrice] = useState<string>("0");
  const [isSDKLoaded, setIsSDKLoaded] = useState(false);
  const [context, setContext] = useState<Context.FrameContext | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0); // Для отображения прогресса

  // Создаем отдельный провайдер для отслеживания транзакций
  const trackingProvider = new JsonRpcProvider(BASE_RPC_URL);

  const fetchContractData = useCallback(async () => {
    try {
      const provider = new JsonRpcProvider(process.env.NEXT_PUBLIC_RPC_URL);
      const contract = new Contract(contractAddress!, abi, provider);

      const minted = await contract.totalMinted();
      const supply = await contract.MAX_SUPPLY();
      const price = await contract.MINT_PRICE();

      setTotalMinted(Number(minted));
      setMaxSupply(Number(supply));
      setMintPrice(formatEther(price));
    } catch (error) {
      console.error("Error fetching contract data:", error);
    }
  }, []);

  // Функция для отслеживания статуса транзакции
  const monitorTransaction = useCallback(async (hash: string) => {
    let retries = 0;
    const maxRetries = 20; // Примерно 2 минуты (с интервалом в 6 секунд)
    
    const checkTx = async () => {
      try {
        setProgress(Math.min(95, (retries / maxRetries) * 100));
        
        const tx = await trackingProvider.getTransaction(hash);
        if (!tx) {
          retries++;
          if (retries > maxRetries) {
            setStatus(TxStatus.FAILED);
            setStatusMessage("Transaction timed out. Please check explorer.");
            return;
          }
          setTimeout(checkTx, 6000);
          return;
        }
        
        // Если транзакция найдена, но нет подтверждений
        if (tx && !tx.confirmations) {
          setStatus(TxStatus.PENDING);
          setStatusMessage("Transaction is in progress...");
          retries++;
          setTimeout(checkTx, 6000);
          return;
        }
        
        // Проверяем квитанцию для определения успеха/неудачи
        const receipt = await trackingProvider.getTransactionReceipt(hash);
        if (receipt && receipt.status === 1) {
          setStatus(TxStatus.CONFIRMED);
          setStatusMessage("NFT successfully minted! 🎉");
          setProgress(100);
          fetchContractData(); // Обновляем данные после успешной транзакции
        } else {
          setStatus(TxStatus.FAILED);
          setStatusMessage("Transaction failed. Please try again.");
        }
      } catch (error) {
        console.log("Error checking transaction:", error);
        retries++;
        if (retries <= maxRetries) {
          setTimeout(checkTx, 6000);
        } else {
          setStatusMessage("Could not verify transaction status.");
        }
      }
    };
    
    setStatus(TxStatus.SUBMITTED);
    setStatusMessage("Transaction submitted. Waiting for confirmation...");
    setTimeout(checkTx, 3000); // Даем время на попадание транзакции в мемпул
  }, [fetchContractData, trackingProvider]);

  // Функция для открытия окна с транзакцией через SDK
  const openTransaction = useCallback((hash: string) => {
    sdk.actions.openUrl(`https://basescan.org/tx/${hash}`);
  }, []);

  const handleMint = useCallback(async () => {
    try {
      setStatus(TxStatus.PREPARING);
      setStatusMessage("Preparing transaction...");
      setProgress(5);
      
      // Получаем провайдер напрямую из SDK Farcaster
      const ethProvider = sdk.wallet.ethProvider;
      
      // Оборачиваем его в ethers provider
      const provider = new BrowserProvider(ethProvider);
      const signer = await provider.getSigner();
      
      setStatus(TxStatus.AWAITING_APPROVAL);
      setStatusMessage("Please approve the transaction in your wallet");
      setProgress(10);
      
      // Проверяем цену минтинга
      const actualMintPrice = mintPrice || "0.0001";
      
      // Формируем правильную транзакцию
      const valueInWei = parseEther(actualMintPrice);
      const mintFunctionSelector = "0x1249c58b"; // keccak256("mint()").substring(0, 10)
      
      try {
        // Отправляем транзакцию с явным указанием всех параметров
        const tx = await signer.sendTransaction({
          to: contractAddress,
          data: mintFunctionSelector,
          value: valueInWei,
          gasLimit: 300000n // Достаточно для большинства mint операций
        });
        
        setTxHash(tx.hash);
        
        // Запускаем мониторинг транзакции
        monitorTransaction(tx.hash);
        
      } catch (error) {
        console.error("Transaction error:", error);
        
        // Проверяем типичные ошибки отмены пользователем
        const errorString = String(error).toLowerCase();
        
        if (errorString.includes("user rejected") || 
            errorString.includes("user denied") || 
            errorString.includes("rejected") || 
            errorString.includes("denied") || 
            errorString.includes("cancelled") || 
            errorString.includes("canceled") ||
            errorString.includes("user cancel")) {
          
          // Пользователь отменил транзакцию - возвращаем к начальному состоянию
          setStatus(TxStatus.NONE);
          setStatusMessage(null);
          setProgress(0);
          setTxHash(null);
          
          // Никаких сообщений об ошибках, просто тихо возвращаем в исходное состояние
          return;
        }
        
        if (String(error).includes("estimateGas") || String(error).includes("eth_getTransactionReceipt")) {
          // Запасной вариант - открытие URL
          setStatusMessage("Opening wallet for confirmation...");
          sdk.actions.openUrl(
            `https://warpcast.com/~/transactions?chain=base&to=${contractAddress}&value=${valueInWei.toString()}&data=${mintFunctionSelector}`
          );
        } else {
          setStatus(TxStatus.FAILED);
          setStatusMessage(`Transaction failed. Please try again.`); // Более общее сообщение
        }
      }
    } catch (error) {
      console.error("Error minting NFT:", error);
      setStatus(TxStatus.FAILED);
      setStatusMessage(`Failed to mint NFT: ${error.message || String(error)}`);
    }
  }, [mintPrice, monitorTransaction]);

  useEffect(() => {
    const load = async () => {
      try {
        const context = await sdk.context;
        setContext(context);
        sdk.actions.ready({});
      } catch (error) {
        console.error("Error loading SDK context:", error);
      }
    };

    if (!isSDKLoaded) {
      setIsSDKLoaded(true);
      load();
      return () => {
        sdk.removeAllListeners();
      };
    }
  }, [isSDKLoaded]);

  useEffect(() => {
    fetchContractData();
  }, [fetchContractData]);

  if (!isSDKLoaded) {
    return <div>Loading...</div>;
  }

  return (
    <div style={{ 
      textAlign: "center", 
      padding: "24px",
      background: "#F8F9FA", // Темнее для большей контрастности с синим
      borderRadius: "8px",
      fontFamily: "'Press Start 2P', 'Courier New', monospace",
      color: "#fff",
      maxWidth: "500px",
      margin: "0 auto",
      position: "relative",
      overflow: "hidden"
    }}>
      <div style={{ position: "relative", zIndex: 1 }}>
        {/* Pixelated header - обновлен на синий Base */}
        <h1 style={{ 
          fontFamily: "'Press Start 2P', 'Courier New', monospace",
          fontSize: "22px", 
          fontWeight: "700",
          margin: "10px 0 20px",
          color: "#0052FF", // Base синий
          textTransform: "uppercase",
          letterSpacing: "1px"
        }}>
          REKT & BROKE
        </h1>

        {/* NFT image - обновлена рамка на Base синий */}
        <div style={{
          position: "relative",
          width: "90%",
          margin: "10px auto 20px",
          borderRadius: "4px",
          overflow: "hidden",
          boxShadow: "0 4px 12px rgba(0, 82, 255, 0.15)" // Синее свечение
        }}>
          <img
            src="https://maroon-occupational-hoverfly-493.mypinata.cloud/ipfs/bafkreiaepcjam42w6hxqwza6f4ax7d4qumg4rfh3pv4euhdcurpliuz6bm"
            alt="NFT Preview"
            style={{
              width: "100%",
              height: "auto",
              display: "block",
              imageRendering: "pixelated"
            }}
          />
          {status === TxStatus.CONFIRMED && (
            <div style={{
              position: "absolute",
              top: "10px",
              right: "10px",
              background: "#00C089", // Зеленый в стиле Base
              color: "black",
              fontSize: "10px",
              fontWeight: "bold",
              fontFamily: "'Press Start 2P', 'Courier New', monospace",
              borderRadius: "4px",
              padding: "5px 10px"
            }}>
              MINTED!
            </div>
          )}
        </div>

        {/* Description - обновлен на темный фон */}
        <div style={{
          fontSize: "12px",
          lineHeight: "1.5",
          marginBottom: "20px",
          color: "#000000",
          padding: "10px",
          background: "#ffffff", // Темно-серый в стиле Base
          borderRadius: "4px"
        }}>
          Got rekt on the dip? Wallet's empty, dreams shattered? Mint this NFT to  <br/>
          <span style={{ color: "#0052FF" }}>flex your pain</span> on Base—because even in a bear market, degens rise from the ashes!
          <span style={{ color: "#00C089" }}> 🔥</span>
        </div>
        
        {/* Mint button - обновлен на синий Base */}
        <button
          onClick={handleMint}
          disabled={[TxStatus.SUBMITTED, TxStatus.PENDING, TxStatus.AWAITING_APPROVAL].includes(status)}
          style={{
            margin: "10px",
            padding: "12px 25px",
            fontSize: "14px",
            fontWeight: "bold",
            fontFamily: "'Press Start 2P', 'Courier New', monospace",
            cursor: [TxStatus.SUBMITTED, TxStatus.PENDING, TxStatus.AWAITING_APPROVAL].includes(status) ? "not-allowed" : "pointer",
            background: [TxStatus.SUBMITTED, TxStatus.PENDING, TxStatus.AWAITING_APPROVAL].includes(status) 
              ? "#333333" 
              : status === TxStatus.CONFIRMED 
                ? "#00C089" 
                : status === TxStatus.FAILED 
                  ? "#FF6868" 
                  : "#0052FF", // Base синий
            color: status === TxStatus.CONFIRMED ? "#000" : "#fff",
            border: "none",
            borderRadius: "4px",
            textTransform: "uppercase",
            letterSpacing: "1px",
            transition: "all 0.3s ease",
            opacity: [TxStatus.SUBMITTED, TxStatus.PENDING, TxStatus.AWAITING_APPROVAL].includes(status) ? 0.7 : 1
          }}
        >
          {status === TxStatus.NONE ? "MINT NFT" : 
           status === TxStatus.CONFIRMED ? "MINTED!" : 
           status === TxStatus.FAILED ? "TRY AGAIN" : 
           "PROCESSING..."}
        </button>
        
        {/* Progress bar - обновлен на синий Base */}
        {[TxStatus.PREPARING, TxStatus.AWAITING_APPROVAL, TxStatus.SUBMITTED, TxStatus.PENDING].includes(status) && (
          <div style={{ 
            width: "100%", 
            backgroundColor: "#1A1A1A",
            borderRadius: "4px", 
            height: "12px",
            margin: "20px 0",
            overflow: "hidden"
          }}>
            <div style={{ 
              width: `${progress}%`, 
              height: "100%", 
              background: status === TxStatus.PENDING ? 
                "#0066FF" : // Более светлый синий
                "#0052FF", // Base синий
              transition: "width 0.3s ease-in-out"
            }}></div>
          </div>
        )}
        
        {/* Status display - обновлен на цвета Base */}
        {statusMessage && (
          <div style={{
            marginTop: "15px",
            padding: "10px 15px",
            backgroundColor: status === TxStatus.CONFIRMED ? "rgba(0, 192, 137, 0.1)" : 
                            status === TxStatus.FAILED ? "rgba(255, 104, 104, 0.1)" :
                            "rgba(0, 82, 255, 0.1)",
            borderRadius: "4px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px"
          }}>
            <p style={{ 
              color: status === TxStatus.CONFIRMED ? "#00C089" : 
                    status === TxStatus.FAILED ? "#FF6868" : "#0052FF",
              fontWeight: "bold",
              fontSize: "11px",
              fontFamily: "'Press Start 2P', 'Courier New', monospace",
              margin: 0
            }}>
              {statusMessage}
            </p>
          </div>
        )}
        
        {/* Transaction hash display - обновлен на стиль Base */}
        {txHash && (
          <div style={{
            marginTop: "15px",
            padding: "8px 10px",
            backgroundColor: "#1A1A1A",
            borderRadius: "4px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px"
          }}>
            <div style={{
              fontSize: "11px",
              color: "#E5E7EB",
              fontFamily: "monospace"
            }}>
              <span>
                TX:{txHash.substring(0, 6)}..{txHash.substring(txHash.length - 4)}
              </span>
            </div>
            <button
              onClick={() => openTransaction(txHash)}
              style={{
                background: "#0052FF", // Base синий
                border: "none",
                borderRadius: "4px",
                color: "white",
                fontSize: "10px",
                padding: "4px 8px",
                cursor: "pointer",
                fontWeight: "bold",
                fontFamily: "'Press Start 2P', 'Courier New', monospace",
                textTransform: "uppercase"
              }}
            >
              View
            </button>
          </div>
        )}
        
        {/* Footer - цвет обновлён */}
        <div style={{
          marginTop: "5px",
          fontSize: "8px",
          color: "#888888",
          fontFamily: "'Press Start 2P', 'Courier New', monospace",
        }}>
          MADE BY HOYANGER
        </div>
      </div>
    </div>
  );
}