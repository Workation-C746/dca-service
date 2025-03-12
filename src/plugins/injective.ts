
import {
    MsgExecuteContract,
    BaseAccount,
    ChainRestAuthApi,
    createTransaction,
    ChainRestTendermintApi,
    PrivateKey,
    ChainGrpcBankApi,
    TxRestApi
} from "@injectivelabs/sdk-ts";
import { BigNumberInBase } from "@injectivelabs/utils";
import { DEFAULT_BLOCK_TIMEOUT_HEIGHT } from "@injectivelabs/utils";
import { ChainId } from "@injectivelabs/ts-types";
import { DCAPlugin } from "./types";
import { Network, getNetworkEndpoints } from "@injectivelabs/networks";
import dotenv from 'dotenv';
import { logger } from '../utils/logger';
dotenv.config();

export class InjectivePlugin implements DCAPlugin {
    name = "injective";
    private readonly CONTRACT_ADDRESS = 'inj1wdx4lnl4amctfgwgujhepf7tjn3ygk37a3sgfj';
    private readonly USDT_DENOM = 'peggy0x87aB3B4C8661e07D6372361211B96ed4Dc36B1B5';
    private readonly INJ_DENOM = 'inj';
    private readonly restEndpoint: string;
    private readonly grpcEndpoint: string;
    private readonly chainId: string;

    constructor() {
        const network = Network.TestnetK8s;
        const endpoints = getNetworkEndpoints(network);
        this.restEndpoint = endpoints.rest;
        this.grpcEndpoint = endpoints.grpc;
        this.chainId = ChainId.Testnet;
    }

    async sendTransaction(
        amount: number,
        fromAddress: string,
        toAddress: string
    ): Promise<string> {
        try {
            // CHANGED: Using mnemonic instead of private key
            const mnemonic = process.env.MNEMONIC_INJECTIVE;
            if (!mnemonic) {
                throw new Error("Mnemonic not found in environment variables (MNEMONIC_INJECTIVE)");
            }

            // CHANGED: Create private key from mnemonic
            const privateKey = PrivateKey.fromMnemonic(mnemonic);
            const walletAddress = privateKey.toBech32();
            
            logger.info(`Using wallet address: ${walletAddress}`);
            logger.info(`Sending swapped tokens to: ${toAddress}`);
            logger.info(`Swap amount: ${amount} USDT`);

            // For this implementation, we'll swap USDT to INJ
            const fromDenom = this.USDT_DENOM;
            const toDenom = this.INJ_DENOM;
            
            // Convert amount to proper decimals (USDT has 6 decimals)
            const amountInBaseUnits = new BigNumberInBase(amount)
                .times(new BigNumberInBase(10).pow(6))
                .toFixed(0);

            // Prepare the swap message
            const swapMsg = {
                swap_min_output: {
                    target_denom: toDenom,
                    min_output_quantity: "0.5" // Minimum INJ to receive
                }
            };

            // Create the execute contract message
            const msg = MsgExecuteContract.fromJSON({
                sender: walletAddress,
                contractAddress: this.CONTRACT_ADDRESS,
                msg: swapMsg,
                funds: [{ 
                    denom: fromDenom, 
                    amount: amountInBaseUnits
                }]
            });

            /** Account Details **/
            const chainRestAuthApi = new ChainRestAuthApi(this.restEndpoint);
            const accountDetailsResponse = await chainRestAuthApi.fetchAccount(walletAddress);
            const baseAccount = BaseAccount.fromRestApi(accountDetailsResponse);

            /** Block Details */
            const chainRestTendermintApi = new ChainRestTendermintApi(this.restEndpoint);
            const latestBlock = await chainRestTendermintApi.fetchLatestBlock();
            const latestHeight = latestBlock.header.height;
            const timeoutHeight = new BigNumberInBase(latestHeight).plus(DEFAULT_BLOCK_TIMEOUT_HEIGHT);

            // CHANGED: Updated fee structure for better gas estimation
            const customFee = {
                amount: [
                    {
                        denom: 'inj',
                        amount: '5000000000000000', // 0.005 INJ (increased)
                    },
                ],
                gas: '2000000', // 2,000,000 gas units (increased)
            };

            /** Prepare the Transaction **/
            const { txRaw, signDoc, signBytes } = createTransaction({
                pubKey: privateKey.toPublicKey().toBase64(),
                chainId: this.chainId,
                fee: customFee,
                message: msg,
                sequence: baseAccount.sequence,
                timeoutHeight: timeoutHeight.toNumber(),
                accountNumber: baseAccount.accountNumber,
            });

            const bytesToSign = signBytes ? signBytes : Buffer.from(signDoc.bodyBytes);
            const signature = await privateKey.sign(Buffer.from(bytesToSign));
            txRaw.signatures = [Buffer.from(signature)];
            
            // Initialize the txClient
            const txClient = new TxRestApi(this.restEndpoint);
            
            // Broadcast the transaction
            const txResponse = await txClient.broadcast(txRaw);
            
            if (txResponse.txHash) {
                logger.info(`Swap transaction successful: ${txResponse.txHash}`);
                
                // After swap is complete, send INJ to desired address if different from wallet
                if (toAddress !== walletAddress) {
                    logger.info(`Swapped tokens need to be sent to ${toAddress}`);
                }
                
                return txResponse.txHash;
            } else {
                throw new Error(`Broadcast response missing txHash: ${JSON.stringify(txResponse)}`);
            }
        } catch (error) {
            logger.error(`Failed to execute swap: ${error}`);
            throw new Error(`Failed to execute swap: ${error}`);
        }
    }

    async getUSDTBalance(address: string): Promise<number> {
        try {
            const bankClient = new ChainGrpcBankApi(this.grpcEndpoint);
            
            // Query USDT balance
            const response = await bankClient.fetchBalance({
                accountAddress: address,
                denom: this.USDT_DENOM
            });
            
            // Convert to human-readable format with 6 decimals
            const balance = new BigNumberInBase(response.amount)
                .dividedBy(new BigNumberInBase(10).pow(6))
                .toNumber();
                
            return balance;
        } catch (error) {
            // If no balance found or error occurs, return 0
            logger.error(`Failed to get USDT balance: ${error}`);
            return 0;
        }
    }

    async getNativeBalance(address: string): Promise<number> {
        try {
            const bankClient = new ChainGrpcBankApi(this.grpcEndpoint);
            
            // Query INJ balance
            const response = await bankClient.fetchBalance({
                accountAddress: address,
                denom: this.INJ_DENOM
            });
            
            // Convert to human-readable format with 18 decimals
            const balance = new BigNumberInBase(response.amount)
                .dividedBy(new BigNumberInBase(10).pow(18))
                .toNumber();
                
            return balance;
        } catch (error) {
            // If no balance found or error occurs, return 0
            logger.error(`Failed to get INJ balance: ${error}`);
            return 0;
        }
    }
}