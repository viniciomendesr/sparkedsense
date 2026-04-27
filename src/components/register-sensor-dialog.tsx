import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Copy, Check, Database, TestTube2, Loader2, Wallet, AlertCircle, ShieldAlert } from 'lucide-react';
import { Sensor } from '../lib/types';
import { Card } from './ui/card';
import { sensorAPI } from '../lib/api';
import { useAuth } from '../lib/auth-context';

interface RegisterSensorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegister: (sensor: Omit<Sensor, 'id' | 'owner' | 'createdAt' | 'status'>) => void;
}

export function RegisterSensorDialog({ open, onOpenChange, onRegister }: RegisterSensorDialogProps) {
  const { accessToken } = useAuth();
  const [step, setStep] = useState<'mode' | 'form' | 'wallet' | 'unsigned-device' | 'token'>('mode');
  const [mode, setMode] = useState<Sensor['mode']>('real');
  const [name, setName] = useState('');
  const [type, setType] = useState<Sensor['type']>('temperature');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Sensor['visibility']>('public');
  const [claimToken, setClaimToken] = useState('');
  const [walletPublicKey, setWalletPublicKey] = useState('');
  const [macAddress, setMacAddress] = useState('');
  const [devicePublicKey, setDevicePublicKey] = useState('');
  const [tokenOption, setTokenOption] = useState<'retrieve' | 'paste'>('retrieve');
  const [pastedToken, setPastedToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [isRetrievingToken, setIsRetrievingToken] = useState(false);
  const [isRegisteringUnsignedDevice, setIsRegisteringUnsignedDevice] = useState(false);
  const [unsignedDeviceError, setUnsignedDeviceError] = useState('');
  const [retrievalError, setRetrievalError] = useState('');
  const [retrievalSuccess, setRetrievalSuccess] = useState(false);
  const [walletError, setWalletError] = useState('');
  const [macError, setMacError] = useState('');
  const [deviceKeyError, setDeviceKeyError] = useState('');
  const [pasteError, setPasteError] = useState('');

  const handleModeSelect = (selectedMode: Sensor['mode']) => {
    setMode(selectedMode);
    setStep('form');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // For mock sensors, proceed directly to token step
    if (mode === 'mock') {
      const token = `CLAIM_${Math.random().toString(36).substring(2, 15).toUpperCase()}`;
      setClaimToken(token);

      onRegister({
        name,
        type,
        description,
        visibility,
        mode,
        claimToken: token,
      });

      setStep('token');
    } else if (mode === 'unverified') {
      // ADR-012: physical device with pending signing pipeline. Skip wallet/NFT,
      // go to the MAC + device pubkey form which calls register-device Step 1.
      setStep('unsigned-device');
    } else {
      // For real sensors, proceed to wallet step
      setStep('wallet');
    }
  };

  // ADR-012: unsigned_dev registration — register the device row via Step 1 of
  // /server/register-device, then create the sensor linked by devicePublicKey.
  const handleUnsignedDeviceSubmit = async () => {
    if (!macAddress || !devicePublicKey || macError || deviceKeyError) return;

    setIsRegisteringUnsignedDevice(true);
    setUnsignedDeviceError('');

    try {
      await sensorAPI.registerDeviceStep1(macAddress, devicePublicKey);

      onRegister({
        name,
        type,
        description,
        visibility,
        mode: 'unverified',
        devicePublicKey,
      });

      setStep('token');
    } catch (error: any) {
      console.error('Failed to register unsigned_dev sensor:', error);
      setUnsignedDeviceError(
        error?.message || 'Unable to register device. Check MAC/public key and try again.',
      );
    } finally {
      setIsRegisteringUnsignedDevice(false);
    }
  };

  const validateSolanaPublicKey = (key: string): boolean => {
    // Solana public keys are base58 encoded and typically 32-44 characters
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    return base58Regex.test(key);
  };

  const validateMacAddress = (mac: string): boolean => {
    // MAC address format: XX:XX:XX:XX:XX:XX or XX-XX-XX:XX:XX:XX
    const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
    return macRegex.test(mac);
  };

  const validateDevicePublicKey = (key: string): boolean => {
    // Real-data flow uses base58 (Solana-style) device keys.
    // ADR-012 unsigned_dev flow uses raw hex pubkeys (secp256k1, 64 or 66+ hex chars).
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    const hexRegex = /^[0-9a-fA-F]{64,130}$/;
    if (mode === 'unverified') return hexRegex.test(key);
    return base58Regex.test(key);
  };

  const handleWalletPublicKeyChange = (value: string) => {
    setWalletPublicKey(value);
    if (value && !validateSolanaPublicKey(value)) {
      setWalletError('Invalid Solana public key format');
    } else {
      setWalletError('');
    }
    // Clear success/error states when user changes input
    setRetrievalSuccess(false);
    setRetrievalError('');
  };

  const handleMacAddressChange = (value: string) => {
    setMacAddress(value);
    if (value && !validateMacAddress(value)) {
      setMacError('Invalid MAC address format (e.g., AA:BB:CC:DD:EE:FF)');
    } else {
      setMacError('');
    }
    // Clear success/error states when user changes input
    setRetrievalSuccess(false);
    setRetrievalError('');
  };

  const handleDevicePublicKeyChange = (value: string) => {
    setDevicePublicKey(value);
    if (value && !validateDevicePublicKey(value)) {
      setDeviceKeyError('Invalid Device public key format');
    } else {
      setDeviceKeyError('');
    }
    // Clear success/error states when user changes input
    setRetrievalSuccess(false);
    setRetrievalError('');
  };

  const validateClaimToken = (token: string): boolean => {
    // Basic validation for claim token format
    // Accept formats like: CLAIM_XXX, SPARKED-XXX, or any alphanumeric token
    return token.length >= 10 && /^[A-Za-z0-9_-]+$/.test(token);
  };

  const handlePastedTokenChange = (value: string) => {
    setPastedToken(value);
    if (value && !validateClaimToken(value)) {
      setPasteError('Invalid Claim Token format');
    } else {
      setPasteError('');
      // If valid, set it as the claim token
      if (value && validateClaimToken(value)) {
        setClaimToken(value);
      } else {
        setClaimToken('');
      }
    }
  };

  const handleTokenOptionChange = (value: 'retrieve' | 'paste') => {
    setTokenOption(value);
    // Clear states when switching options
    setRetrievalError('');
    setRetrievalSuccess(false);
    setPasteError('');
    setClaimToken('');
    
    // If switching to paste and we have a valid pasted token, use it
    if (value === 'paste' && pastedToken && validateClaimToken(pastedToken)) {
      setClaimToken(pastedToken);
    }
  };

  const handleRetrieveClaimToken = async () => {
    if (!accessToken || !walletPublicKey || !macAddress || !devicePublicKey || walletError || macError || deviceKeyError) return;
    
    setIsRetrievingToken(true);
    setRetrievalError('');
    setRetrievalSuccess(false);
    
    try {
      const token = await sensorAPI.retrieveClaimToken(walletPublicKey, macAddress, devicePublicKey, accessToken);
      setClaimToken(token);
      setRetrievalSuccess(true);
    } catch (error) {
      console.error('Failed to retrieve claim token:', error);
      setRetrievalError('Unable to retrieve Claim Token. Please check your inputs and try again.');
      setClaimToken('');
    } finally {
      setIsRetrievingToken(false);
    }
  };

  const handleWalletSubmit = () => {
    if (!claimToken || !walletPublicKey || walletError) return;
    
    onRegister({
      name,
      type,
      description,
      visibility,
      mode,
      claimToken,
      walletPublicKey,
    });
    
    setStep('token');
  };

  const handleCopy = async () => {
    try {
      // Try modern clipboard API first
      await navigator.clipboard.writeText(claimToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback for environments where Clipboard API is blocked
      try {
        const textArea = document.createElement('textarea');
        textArea.value = claimToken;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (successful) {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
      } catch (fallbackErr) {
        console.error('Failed to copy:', fallbackErr);
      }
    }
  };

  const handleClose = () => {
    setStep('mode');
    setMode('real');
    setName('');
    setType('temperature');
    setDescription('');
    setVisibility('public');
    setClaimToken('');
    setWalletPublicKey('');
    setMacAddress('');
    setDevicePublicKey('');
    setTokenOption('retrieve');
    setPastedToken('');
    setWalletError('');
    setMacError('');
    setDeviceKeyError('');
    setPasteError('');
    setRetrievalError('');
    setRetrievalSuccess(false);
    setCopied(false);
    setIsRetrievingToken(false);
    setIsRegisteringUnsignedDevice(false);
    setUnsignedDeviceError('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-card border-border max-w-3xl max-h-[90vh] overflow-y-auto">
        {step === 'mode' ? (
          <>
            <DialogHeader>
              <DialogTitle style={{ color: 'var(--text-primary)' }}>Choose Sensor Mode</DialogTitle>
              <DialogDescription style={{ color: 'var(--text-secondary)' }}>
                Select how your sensor will generate data
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 mt-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card
                  className="p-6 cursor-pointer border-2 hover:border-primary/50 transition-all duration-200"
                  onClick={() => handleModeSelect('real')}
                >
                  <div className="flex flex-col items-center text-center space-y-3">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Database className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="mb-2" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        Real Data Sensor
                      </h3>
                      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        For physical devices that will send live readings via API
                      </p>
                    </div>
                  </div>
                </Card>

                <Card
                  className="p-6 cursor-pointer border-2 hover:border-secondary/50 transition-all duration-200"
                  onClick={() => handleModeSelect('mock')}
                >
                  <div className="flex flex-col items-center text-center space-y-3">
                    <div className="w-12 h-12 rounded-lg bg-secondary/10 flex items-center justify-center">
                      <TestTube2 className="w-6 h-6 text-secondary" />
                    </div>
                    <div>
                      <h3 className="mb-2" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        Mock Data Sensor
                      </h3>
                      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        For testing and demos with automatically generated readings
                      </p>
                    </div>
                  </div>
                </Card>

                <Card
                  className="p-6 cursor-pointer border-2 hover:border-warning/50 transition-all duration-200"
                  onClick={() => handleModeSelect('unverified')}
                >
                  <div className="flex flex-col items-center text-center space-y-3">
                    <div className="w-12 h-12 rounded-lg bg-warning/10 flex items-center justify-center">
                      <ShieldAlert className="w-6 h-6 text-warning" />
                    </div>
                    <div>
                      <h3 className="mb-2" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        Unverified Sensor
                      </h3>
                      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        Physical device that publishes data immediately; mint NFT later from the sensor page
                      </p>
                    </div>
                  </div>
                </Card>
              </div>

              <div className="p-4 rounded-lg bg-info/10 border border-info/30">
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  💡 Mock sensors generate random readings for demos. Unverified sensors accept real data right away — you can mint the NFT later from the sensor detail page (ADR-014).
                </p>
              </div>

              <Button 
                variant="outline" 
                onClick={handleClose}
                className="w-full border-border"
              >
                Cancel
              </Button>
            </div>
          </>
        ) : step === 'form' ? (
          <>
            <DialogHeader>
              <DialogTitle style={{ color: 'var(--text-primary)' }}>Register New Sensor</DialogTitle>
              <DialogDescription style={{ color: 'var(--text-secondary)' }}>
                {mode === 'real' 
                  ? "Register a physical sensor and mint it as an on-chain NFT. You'll receive a claim token for firmware authentication."
                  : "Create a mock sensor for testing. It will automatically generate simulated readings."}
              </DialogDescription>
            </DialogHeader>
            
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="name">Sensor Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Lab Temperature Monitor"
                  required
                  className="bg-input border-border"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="type">Sensor Type</Label>
                <Select value={type} onValueChange={(value) => setType(value as Sensor['type'])}>
                  <SelectTrigger className="bg-input border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="temperature">Temperature</SelectItem>
                    <SelectItem value="humidity">Humidity</SelectItem>
                    <SelectItem value="ph">pH Level</SelectItem>
                    <SelectItem value="pressure">Pressure</SelectItem>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="co2">CO2</SelectItem>
                    <SelectItem value="acoustic">Acoustic (keyword spotting)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description of the sensor and its purpose"
                  rows={3}
                  className="bg-input border-border resize-none"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="visibility">Visibility</Label>
                <Select value={visibility} onValueChange={(value) => setVisibility(value as Sensor['visibility'])}>
                  <SelectTrigger className="bg-input border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="public">Public - All data visible</SelectItem>
                    <SelectItem value="private">Private - Owner only</SelectItem>
                    <SelectItem value="partial">Partial - Metadata public</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-3 pt-4">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={handleClose}
                  className="flex-1 border-border"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit"
                  className="flex-1 bg-primary text-primary-foreground"
                >
                  Register Sensor
                </Button>
              </div>
            </form>
          </>
        ) : step === 'wallet' ? (
          <>
            <DialogHeader>
              <DialogTitle style={{ color: 'var(--text-primary)' }}>Connect to Blockchain</DialogTitle>
              <DialogDescription style={{ color: 'var(--text-secondary)' }}>
                You can retrieve a new Claim Token using your wallet and device address, or paste an existing one if you already have it.
              </DialogDescription>
            </DialogHeader>

            {/* Scrollable Content Container */}
            <div className="max-h-[60vh] overflow-y-auto pr-2 -mr-2">
              <div className="space-y-6 mt-4">
                {/* Solana Wallet Public Key - Always visible */}
                <div className="space-y-3">
                  <Label htmlFor="wallet-key">Solana Wallet Public Key</Label>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Paste the public key of your Solana wallet. It will be used to register this sensor on-chain.
                  </p>
                  
                  <div className="space-y-2">
                    <div className="relative">
                      <Wallet className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="wallet-key"
                        value={walletPublicKey}
                        onChange={(e) => handleWalletPublicKeyChange(e.target.value)}
                        placeholder="Enter Solana wallet public key (base58)"
                        className={`bg-input border-border pl-10 ${walletError ? 'border-error' : ''}`}
                      />
                    </div>
                    
                    {walletError && (
                      <p className="text-sm" style={{ color: 'var(--error)' }}>
                        {walletError}
                      </p>
                    )}
                  </div>
                </div>

                {/* Separator */}
                <div className="border-t border-border pt-6">
                  <Label className="mb-3 block">Claim Token Options</Label>
                  
                  {/* Radio Group for Token Options */}
                  <RadioGroup value={tokenOption} onValueChange={handleTokenOptionChange}>
                    <div className="space-y-4">
                      {/* Option 1: Retrieve Claim Token */}
                      <div className="flex items-start space-x-3">
                        <RadioGroupItem value="retrieve" id="retrieve-option" className="mt-0.5" />
                        <div className="flex-1">
                          <Label htmlFor="retrieve-option" className="cursor-pointer">
                            <span style={{ color: 'var(--text-primary)' }}>Retrieve Claim Token (API-based)</span>
                          </Label>
                          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                            Enter your device public key and MAC address to retrieve your Claim Token
                          </p>
                        </div>
                      </div>

                      {/* Option 2: Paste Existing Token */}
                      <div className="flex items-start space-x-3">
                        <RadioGroupItem value="paste" id="paste-option" className="mt-0.5" />
                        <div className="flex-1">
                          <Label htmlFor="paste-option" className="cursor-pointer">
                            <span style={{ color: 'var(--text-primary)' }}>Paste Existing Claim Token</span>
                          </Label>
                          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                            Already have a token? Paste it here to complete registration
                          </p>
                        </div>
                      </div>
                    </div>
                  </RadioGroup>
                </div>

                {/* Conditional Content Based on Selected Option */}
                {tokenOption === 'retrieve' ? (
                  <>
                    {/* Device Public Key Section */}
                    <div className="space-y-3">
                      <Label htmlFor="device-key">Device Public Key</Label>
                      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        Enter the public key generated by your IoT device, used to verify ownership and digital signatures.
                      </p>
                      
                      <div className="space-y-2">
                        <Input
                          id="device-key"
                          value={devicePublicKey}
                          onChange={(e) => handleDevicePublicKeyChange(e.target.value)}
                          placeholder="e.g., 6T2bF8YqXxP9...N7E5aD4"
                          className={`bg-input border-border ${deviceKeyError ? 'border-error' : ''}`}
                        />
                        
                        {deviceKeyError && (
                          <p className="text-sm" style={{ color: 'var(--error)' }}>
                            Invalid public key format. Please enter a valid base58 string.
                          </p>
                        )}
                      </div>
                    </div>

                    {/* MAC Address Section */}
                    <div className="space-y-3">
                      <Label htmlFor="mac-address">Device MAC Address</Label>
                      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        Enter the MAC address of your physical device (e.g., ESP8266). This uniquely identifies the device.
                      </p>
                      
                      <div className="space-y-2">
                        <Input
                          id="mac-address"
                          value={macAddress}
                          onChange={(e) => handleMacAddressChange(e.target.value)}
                          placeholder="e.g., AA:BB:CC:DD:EE:FF"
                          className={`bg-input border-border ${macError ? 'border-error' : ''}`}
                        />
                        
                        {macError && (
                          <p className="text-sm" style={{ color: 'var(--error)' }}>
                            Invalid MAC address. Use format AA:BB:CC:DD:EE:FF.
                          </p>
                        )}
                      </div>
                    </div>
                    
                    {/* Retrieve Claim Token Button */}
                    <div>
                      <Button
                        type="button"
                        onClick={handleRetrieveClaimToken}
                        disabled={isRetrievingToken || !walletPublicKey || !macAddress || !devicePublicKey || !!walletError || !!macError || !!deviceKeyError}
                        className="w-full bg-primary text-primary-foreground"
                      >
                        {isRetrievingToken ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Retrieving Claim Token...
                          </>
                        ) : (
                          'Retrieve Claim Token'
                        )}
                      </Button>
                    </div>

                    {/* Error Message */}
                    {retrievalError && (
                      <div className="p-3 rounded-lg bg-error/10 border border-error/30">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-error shrink-0" />
                          <p className="text-sm" style={{ color: 'var(--error)' }}>
                            {retrievalError}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Success Message & Retrieved Token Display */}
                    {retrievalSuccess && claimToken && (
                      <div className="space-y-3">
                        <div className="p-3 rounded-lg bg-success/10 border border-success/30">
                          <div className="flex items-center gap-2">
                            <Check className="w-4 h-4 text-success shrink-0" />
                            <p className="text-sm" style={{ color: 'var(--success)' }}>
                              Claim Token successfully retrieved.
                            </p>
                          </div>
                        </div>
                        
                        <div>
                          <Label htmlFor="retrieved-token" className="mb-2 block">Retrieved Claim Token</Label>
                          <div className="p-3 rounded-lg bg-muted/50 border border-border">
                            <div className="flex items-center gap-2">
                              <code className="flex-1 font-mono text-sm break-all" style={{ color: 'var(--text-primary)' }}>
                                {claimToken}
                              </code>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={handleCopy}
                                className="shrink-0"
                              >
                                {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* Paste Existing Claim Token Section */}
                    <div className="space-y-3">
                      <Label htmlFor="paste-token">Paste Your Existing Claim Token</Label>
                      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        If you already have a Claim Token, paste it here to complete your registration without retrieval.
                      </p>
                      
                      <div className="space-y-2">
                        <Input
                          id="paste-token"
                          value={pastedToken}
                          onChange={(e) => handlePastedTokenChange(e.target.value)}
                          placeholder="e.g., SPARKED-XXXXXXXXXXXX or CLAIM_XXXXXXXXXXXX"
                          className={`bg-input border-border ${pasteError ? 'border-error' : ''}`}
                        />
                        
                        {pasteError && (
                          <p className="text-sm" style={{ color: 'var(--error)' }}>
                            {pasteError}
                          </p>
                        )}

                        {!pasteError && pastedToken && claimToken && (
                          <div className="p-3 rounded-lg bg-success/10 border border-success/30">
                            <div className="flex items-center gap-2">
                              <Check className="w-4 h-4 text-success shrink-0" />
                              <p className="text-sm" style={{ color: 'var(--success)' }}>
                                Claim Token successfully linked.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {/* Info Box */}
                <div className="p-4 rounded-lg bg-info/10 border border-info/30">
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    💡 {tokenOption === 'retrieve' 
                      ? 'The Claim Token links your wallet and device to the blockchain. Enter your device public key and MAC address above, then click "Retrieve Claim Token" to proceed.'
                      : 'Paste your existing Claim Token to link it with your wallet and complete registration.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Fixed Action Buttons */}
            <div className="flex gap-3 pt-4 border-t border-border mt-4">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setStep('form')}
                className="flex-1 border-border"
              >
                Back
              </Button>
              <Button
                type="button"
                onClick={handleWalletSubmit}
                disabled={!claimToken || !walletPublicKey || !!walletError}
                className="flex-1 bg-primary text-primary-foreground"
              >
                Complete Registration
              </Button>
            </div>
          </>
        ) : step === 'unsigned-device' ? (
          <>
            <DialogHeader>
              <DialogTitle style={{ color: 'var(--text-primary)' }}>Register Unverified Sensor</DialogTitle>
              <DialogDescription style={{ color: 'var(--text-secondary)' }}>
                Provide the device MAC address and public key. We register the device identity so incoming readings are routed to this sensor. No NFT is minted upfront — you can mint later from the sensor detail page (ADR-014). Events that arrive without a valid signature carry the <code>unsigned_dev</code> wire marker (ADR-011).
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="unsigned-device-key">Device Public Key (hex)</Label>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  secp256k1 public key the firmware declares in the envelope <code>source</code>. 64 hex chars (compressed) or 130 hex chars (uncompressed with <code>04</code> prefix).
                </p>
                <Input
                  id="unsigned-device-key"
                  value={devicePublicKey}
                  onChange={(e) => handleDevicePublicKeyChange(e.target.value)}
                  placeholder="e.g., 021d5e4c3a5b8f2e7d9c4a6b1f3e8d0c5a7b2f9e4d1c8a3b6e5f0d7c2a9b4e1f0d"
                  className={`bg-input border-border font-mono text-xs ${deviceKeyError ? 'border-error' : ''}`}
                />
                {deviceKeyError && (
                  <p className="text-sm" style={{ color: 'var(--error)' }}>
                    Invalid hex public key. Expected 64 or 130 hex chars.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="unsigned-mac">Device MAC Address</Label>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  MAC address of the physical device (ESP32, ESP8266, etc.). Stored alongside the public key for identification.
                </p>
                <Input
                  id="unsigned-mac"
                  value={macAddress}
                  onChange={(e) => handleMacAddressChange(e.target.value)}
                  placeholder="AA:BB:CC:DD:EE:FF"
                  className={`bg-input border-border ${macError ? 'border-error' : ''}`}
                />
                {macError && (
                  <p className="text-sm" style={{ color: 'var(--error)' }}>
                    Invalid MAC address. Use format AA:BB:CC:DD:EE:FF.
                  </p>
                )}
              </div>

              <div className="p-4 rounded-lg bg-warning/10 border border-warning/30">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    The sensor enters <code>unverified</code> state and starts publishing immediately. To enable on-chain attestation, click <strong>Mint NFT</strong> on the sensor detail page (ADR-014). The device public key stays the same after minting.
                  </p>
                </div>
              </div>

              {unsignedDeviceError && (
                <div className="p-3 rounded-lg bg-error/10 border border-error/30">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-error shrink-0" />
                    <p className="text-sm" style={{ color: 'var(--error)' }}>
                      {unsignedDeviceError}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-4 border-t border-border mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep('form')}
                  className="flex-1 border-border"
                  disabled={isRegisteringUnsignedDevice}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  onClick={handleUnsignedDeviceSubmit}
                  disabled={
                    isRegisteringUnsignedDevice ||
                    !macAddress ||
                    !devicePublicKey ||
                    !!macError ||
                    !!deviceKeyError
                  }
                  className="flex-1 bg-warning text-warning-foreground"
                >
                  {isRegisteringUnsignedDevice ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Registering device…
                    </>
                  ) : (
                    'Register Sensor'
                  )}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle style={{ color: 'var(--text-primary)' }}>
                {mode === 'real'
                  ? 'Sensor Successfully Linked!'
                  : mode === 'unverified'
                    ? 'Unsigned Sensor Registered'
                    : 'Sensor Registered Successfully!'}
              </DialogTitle>
              <DialogDescription style={{ color: 'var(--text-secondary)' }}>
                {mode === 'real'
                  ? 'Sensor successfully registered and linked to blockchain.'
                  : mode === 'unverified'
                    ? 'Your sensor is registered under the ADR-011 signature bypass. Readings will be accepted from the device public key you provided — no claim token, no NFT.'
                    : 'Your sensor has been minted as an NFT. Use the claim token below to authenticate your device firmware.'}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-6 space-y-4">
              {/* Top row: identity artifact (claim token / device pubkey / wallet) + status badge */}
              <div
                className={
                  mode === 'unverified' || mode === 'real'
                    ? 'grid grid-cols-1 md:grid-cols-2 gap-4'
                    : 'space-y-4'
                }
              >
                {mode !== 'unverified' && (
                  <div className="p-4 rounded-lg bg-muted/50 border border-border">
                    <Label className="mb-2 block">Claim Token</Label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 font-mono p-2 rounded bg-background border border-border text-xs break-all" style={{ color: 'var(--text-primary)' }}>
                        {claimToken}
                      </code>
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={handleCopy}
                        className="shrink-0 border-border"
                      >
                        {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                )}

                {mode === 'unverified' && devicePublicKey && (
                  <div className="p-4 rounded-lg bg-muted/50 border border-border">
                    <Label className="mb-2 block">Device Public Key</Label>
                    <div className="flex items-start gap-2">
                      <ShieldAlert className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                      <code className="flex-1 font-mono text-xs break-all leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                        {devicePublicKey}
                      </code>
                    </div>
                  </div>
                )}

                {mode === 'real' && walletPublicKey && (
                  <div className="p-4 rounded-lg bg-muted/50 border border-border">
                    <Label className="mb-2 block">Linked Wallet</Label>
                    <div className="flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-primary shrink-0" />
                      <code className="flex-1 font-mono text-xs break-all" style={{ color: 'var(--text-primary)' }}>
                        {walletPublicKey}
                      </code>
                    </div>
                  </div>
                )}

                <div
                  className={`p-4 rounded-lg border ${
                    mode === 'unverified'
                      ? 'bg-warning/10 border-warning/30'
                      : 'bg-success/10 border-success/30'
                  }`}
                >
                  <h4
                    className="mb-2 text-sm"
                    style={{
                      fontWeight: 600,
                      color: mode === 'unverified' ? 'var(--warning)' : 'var(--success)',
                    }}
                  >
                    {mode === 'unverified'
                      ? '⚠ Signature Bypass Active'
                      : `✓ ${mode === 'real' ? 'Blockchain Link Complete' : 'Registration Complete'}`}
                  </h4>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {mode === 'real'
                      ? 'Sensor linked to your Solana wallet. The NFT will be minted on first verified reading.'
                      : mode === 'unverified'
                        ? 'Readings with the unsigned_dev marker are accepted and persisted, but are not eligible for on-chain anchoring until firmware signing is ported.'
                        : 'Your mock sensor is ready to generate test data automatically.'}
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-info/10 border border-info/30">
                <h4 className="mb-2" style={{ fontWeight: 600, color: 'var(--info)' }}>
                  {mode === 'real' ? 'Firmware Setup Instructions' : 'Next Steps'}
                </h4>
                <ol className="text-sm space-y-2" style={{ color: 'var(--text-secondary)' }}>
                  {mode === 'real' ? (
                    <>
                      <li>1. Copy the claim token above</li>
                      <li>2. Add it to your device firmware configuration</li>
                      <li>3. The device will use this token to sign and authenticate readings</li>
                      <li>4. Start sending data to the Edge Tracker API endpoint</li>
                      <li>5. First verified reading will trigger NFT minting to your wallet</li>
                    </>
                  ) : mode === 'unverified' ? (
                    <>
                      <li>1. Firmware publishes envelopes with <code>signature: "unsigned_dev"</code></li>
                      <li>2. The backend validates device identity via the public key you just registered</li>
                      <li>3. Card shows the <code>Unsigned Dev</code> badge while the bypass is active</li>
                      <li>4. When signing lands, this sensor can be upgraded to <code>real</code> without changing its device identity</li>
                    </>
                  ) : (
                    <>
                      <li>1. Mock data will be generated automatically every 5 seconds</li>
                      <li>2. View real-time updates on your dashboard</li>
                      <li>3. Test dataset creation and blockchain anchoring</li>
                      <li>4. Perfect for demos and development</li>
                    </>
                  )}
                </ol>
              </div>

              <Button 
                onClick={handleClose}
                className="w-full bg-primary text-primary-foreground"
              >
                Done
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}