"use client";

import Image from "next/image";
import React, { useState } from 'react';

function claimDevice(claimToken: string, ownerWalletAddress: string) {
  return fetch("/api/claim-device", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ claimToken, ownerWalletAddress }),
  }).then((res) => res.json());
}

export default function Home() {

  const [inputValue, setInputValue] = useState('');
  const [inputWalletAddress, setInputWalletAddress] = useState('');

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(event.target.value);
  };
  const handleWalletAddressChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputWalletAddress(event.target.value);
  }

  // Esta função é chamada APENAS quando o botão é clicado.
  const handleButtonClick = () => {
    claimDevice(inputValue, inputWalletAddress)
  };
  return (
    <div className="font-sans grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20">
      <input
          type="text"
          value={inputValue} // O valor da caixa é controlado pelo nosso estado 'inputValue'.
          onChange={handleInputChange} // A função 'handleInputChange' é chamada a cada mudança.
          placeholder="Token..."
          className="w-full px-4 py-2 text-gray-700 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          type="text"
          value={inputWalletAddress} // O valor da caixa é controlado pelo nosso estado 'inputValue'.
          onChange={handleInputChange} // A função 'handleInputChange' é chamada a cada mudança.
          placeholder="Wallet Address.."
          className="w-full px-4 py-2 text-gray-700 bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <button
          onClick={handleButtonClick} // A função 'handleButtonClick' é chamada no clique.
          className="w-full px-4 py-2 font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors duration-200"
        >
          Chamar a Função
        </button>
    </div>
  );
}
