import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Copy, Check, ChevronRight, ChevronLeft, Wifi, Upload, Key, CheckCircle, HelpCircle } from 'lucide-react';
import { Progress } from './ui/progress';

// Import sensor code
import { temperatureCode } from '../sensor-code/temperature';
import { humidityCode } from '../sensor-code/humidity';
import { phCode } from '../sensor-code/ph';

interface ActivateSensorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

export function ActivateSensorDialog({ open, onOpenChange, onComplete }: ActivateSensorDialogProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedSensorType, setSelectedSensorType] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const totalSteps = 6; // Steps 0-5

  const sensorCodeMap: Record<string, string> = {
    temperature: temperatureCode,
    humidity: humidityCode,
    ph: phCode,
  };

  const handleCopyCode = () => {
    if (selectedSensorType && sensorCodeMap[selectedSensorType]) {
      navigator.clipboard.writeText(sensorCodeMap[selectedSensorType]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleNext = () => {
    if (currentStep < totalSteps - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = () => {
    onComplete();
    onOpenChange(false);
    // Reset state
    setCurrentStep(0);
    setSelectedSensorType('');
    setCopied(false);
  };

  const handleClose = () => {
    onOpenChange(false);
    // Reset state after a delay to avoid visual glitch
    setTimeout(() => {
      setCurrentStep(0);
      setSelectedSensorType('');
      setCopied(false);
    }, 300);
  };

  const progressPercentage = ((currentStep + 1) / totalSteps) * 100;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-card border-border max-w-3xl">
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--text-primary)' }}>
            Activate Physical Sensor
          </DialogTitle>
          <DialogDescription style={{ color: 'var(--text-secondary)' }}>
            Step {currentStep + 1} of {totalSteps}
          </DialogDescription>
        </DialogHeader>

        {/* Progress Bar */}
        <div className="mb-4">
          <Progress value={progressPercentage} className="h-2" />
        </div>

        {/* Scrollable Content Container */}
        <div className="max-h-[60vh] overflow-y-auto pr-2 -mr-2">
          <div className="space-y-6">
            {/* Step 0: Introduction */}
            {currentStep === 0 && (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-info/10 border border-info/30">
                  <h3 className="font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                    Welcome to Sensor Activation
                  </h3>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Because this is an MVP, you'll need to manually upload and edit your device code to connect it to the Edge Tracker infrastructure.
                  </p>
                </div>

                <div className="space-y-3">
                  <p style={{ color: 'var(--text-secondary)' }}>
                    This tutorial will guide you through:
                  </p>
                  <ul className="space-y-2 ml-4">
                    <li className="flex items-start gap-2" style={{ color: 'var(--text-secondary)' }}>
                      <CheckCircle className="w-4 h-4 mt-0.5 text-success shrink-0" />
                      <span className="text-sm">Selecting and copying the correct sensor code</span>
                    </li>
                    <li className="flex items-start gap-2" style={{ color: 'var(--text-secondary)' }}>
                      <CheckCircle className="w-4 h-4 mt-0.5 text-success shrink-0" />
                      <span className="text-sm">Configuring WiFi credentials</span>
                    </li>
                    <li className="flex items-start gap-2" style={{ color: 'var(--text-secondary)' }}>
                      <CheckCircle className="w-4 h-4 mt-0.5 text-success shrink-0" />
                      <span className="text-sm">Uploading code to your device</span>
                    </li>
                    <li className="flex items-start gap-2" style={{ color: 'var(--text-secondary)' }}>
                      <CheckCircle className="w-4 h-4 mt-0.5 text-success shrink-0" />
                      <span className="text-sm">Retrieving your Claim Token</span>
                    </li>
                    <li className="flex items-start gap-2" style={{ color: 'var(--text-secondary)' }}>
                      <CheckCircle className="w-4 h-4 mt-0.5 text-success shrink-0" />
                      <span className="text-sm">Completing sensor registration</span>
                    </li>
                  </ul>
                </div>

                <div className="p-4 rounded-lg bg-muted/50 border border-border">
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>What you'll need:</strong>
                    <br />
                    • ESP8266 or compatible IoT board
                    <br />
                    • Arduino IDE installed
                    <br />
                    • USB cable for device connection
                    <br />
                    • WiFi network credentials
                  </p>
                </div>
              </div>
            )}

            {/* Step 1: Choose Sensor Type & Display Code */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                    Choose Your Sensor Type
                  </h3>
                  <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
                    Select the type of sensor you want to activate, then copy the code below.
                  </p>

                  <div className="space-y-3">
                    <Label htmlFor="sensor-type">Sensor Type</Label>
                    <Select value={selectedSensorType} onValueChange={setSelectedSensorType}>
                      <SelectTrigger id="sensor-type" className="bg-input border-border">
                        <SelectValue placeholder="Select a sensor type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="temperature">Temperature Sensor</SelectItem>
                        <SelectItem value="humidity">Humidity Sensor</SelectItem>
                        <SelectItem value="ph">pH Sensor</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {selectedSensorType && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Sensor Code</Label>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleCopyCode}
                        className="border-border"
                      >
                        {copied ? (
                          <>
                            <Check className="w-4 h-4 mr-2 text-success" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4 mr-2" />
                            Copy Code
                          </>
                        )}
                      </Button>
                    </div>

                    <div className="p-4 rounded-lg bg-muted/50 border border-border overflow-x-auto max-h-96 overflow-y-auto">
                      <pre className="text-xs font-mono" style={{ color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>
                        {sensorCodeMap[selectedSensorType]}
                      </pre>
                    </div>

                    <div className="p-3 rounded-lg bg-info/10 border border-info/30">
                      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        💡 Copy this code and paste it into your Arduino IDE to get started.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Edit WiFi Credentials */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <Wifi className="w-5 h-5" style={{ color: 'var(--primary)' }} />
                  <h3 className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    Configure WiFi Credentials
                  </h3>
                </div>

                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Open the code in your Arduino IDE and replace the WiFi name and password placeholders with your own credentials.
                </p>

                <div className="p-4 rounded-lg bg-muted/50 border border-border">
                  <Label className="mb-2 block">Example Configuration</Label>
                  <pre className="text-sm font-mono" style={{ color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>
{`const char* ssid = "YOUR_WIFI_NAME";
const char* password = "YOUR_WIFI_PASSWORD";`}
                  </pre>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    Steps to edit:
                  </p>
                  <ol className="space-y-2 ml-4 list-decimal">
                    <li className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      Locate the WiFi credentials section near the top of the code
                    </li>
                    <li className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      Replace <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono">YOUR_WIFI_NAME</code> with your network name
                    </li>
                    <li className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      Replace <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono">YOUR_WIFI_PASSWORD</code> with your network password
                    </li>
                    <li className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      Save the file (Ctrl+S or Cmd+S)
                    </li>
                  </ol>
                </div>

                <div className="p-3 rounded-lg bg-warning/10 border border-warning/30">
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    ⚠️ Make sure to keep the quotation marks around your WiFi name and password.
                  </p>
                </div>
              </div>
            )}

            {/* Step 3: Upload Code to Device */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <Upload className="w-5 h-5" style={{ color: 'var(--primary)' }} />
                  <h3 className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    Upload Code to Device
                  </h3>
                </div>

                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Connect your ESP8266 or compatible board via USB and upload the edited code.
                </p>

                <div className="space-y-2">
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    Upload steps:
                  </p>
                  <ol className="space-y-2 ml-4 list-decimal">
                    <li className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      Connect your device to your computer via USB cable
                    </li>
                    <li className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      In Arduino IDE, select <strong>Tools → Board → NodeMCU 1.0 (ESP-12E Module)</strong>
                    </li>
                    <li className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      Select the correct port under <strong>Tools → Port</strong>
                    </li>
                    <li className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      Click the <strong>Upload</strong> button (→ icon) in the Arduino IDE
                    </li>
                    <li className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      Wait for "Done uploading" message
                    </li>
                  </ol>
                </div>

                <div className="p-4 rounded-lg bg-muted/50 border border-border">
                  <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                    Troubleshooting Checklist
                  </p>
                  <ul className="space-y-1">
                    <li className="flex items-start gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      <span className="shrink-0">•</span>
                      <span>Correct board selected (NodeMCU 1.0)</span>
                    </li>
                    <li className="flex items-start gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      <span className="shrink-0">•</span>
                      <span>Correct COM port selected</span>
                    </li>
                    <li className="flex items-start gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      <span className="shrink-0">•</span>
                      <span>USB drivers installed for ESP8266</span>
                    </li>
                    <li className="flex items-start gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      <span className="shrink-0">•</span>
                      <span>Required libraries installed (ESP8266WiFi, ArduinoJson)</span>
                    </li>
                  </ul>
                </div>

                <div className="p-3 rounded-lg bg-success/10 border border-success/30">
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    ✓ After successful upload, your device should start transmitting initial data to Edge Tracker.
                  </p>
                </div>
              </div>
            )}

            {/* Step 4: Retrieve Claim Token */}
            {currentStep === 4 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <Key className="w-5 h-5" style={{ color: 'var(--primary)' }} />
                  <h3 className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    Retrieve Your Claim Token
                  </h3>
                </div>

                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  After running the code, your Claim Token will appear in the Arduino IDE Serial Monitor.
                </p>

                <div className="space-y-2">
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    How to view the Serial Monitor:
                  </p>
                  <ol className="space-y-2 ml-4 list-decimal">
                    <li className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      In Arduino IDE, click <strong>Tools → Serial Monitor</strong>
                    </li>
                    <li className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      Set baud rate to <strong>115200</strong> in the bottom-right dropdown
                    </li>
                    <li className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      Look for a line that says <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono">CLAIM TOKEN: SPARKED-XXXXXXXXXXXX</code>
                    </li>
                    <li className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      Copy the token value for use in registration
                    </li>
                  </ol>
                </div>

                <div className="p-4 rounded-lg bg-muted/50 border border-border">
                  <Label className="mb-2 block">Example Serial Monitor Output</Label>
                  <pre className="text-xs font-mono" style={{ color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>
{`=== Edge Tracker Temperature Sensor ===
CLAIM TOKEN: SPARKED-A1B2C3D4E5F6
Connecting to WiFi....
WiFi Connected!
IP Address: 192.168.1.100
Temperature: 23.5 °C`}
                  </pre>
                </div>

                <div className="p-3 rounded-lg bg-info/10 border border-info/30">
                  <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                    If the Claim Token does not appear:
                  </p>
                  <ul className="space-y-1 ml-4">
                    <li className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      • Check that baud rate is set to 115200
                    </li>
                    <li className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      • Verify the device is powered on and connected
                    </li>
                    <li className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      • Try pressing the reset button on your ESP8266
                    </li>
                    <li className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      • Re-upload the code if necessary
                    </li>
                  </ul>
                </div>
              </div>
            )}

            {/* Step 5: Complete Activation */}
            {currentStep === 5 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="w-5 h-5 text-success" />
                  <h3 className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    Activation Complete!
                  </h3>
                </div>

                <div className="p-4 rounded-lg bg-success/10 border border-success/30">
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    ✓ Your device is now active and transmitting data to Edge Tracker!
                  </p>
                </div>

                <div className="space-y-3">
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    You've successfully:
                  </p>
                  <ul className="space-y-2 ml-4">
                    <li className="flex items-start gap-2" style={{ color: 'var(--text-secondary)' }}>
                      <CheckCircle className="w-4 h-4 mt-0.5 text-success shrink-0" />
                      <span className="text-sm">Configured your sensor code</span>
                    </li>
                    <li className="flex items-start gap-2" style={{ color: 'var(--text-secondary)' }}>
                      <CheckCircle className="w-4 h-4 mt-0.5 text-success shrink-0" />
                      <span className="text-sm">Uploaded code to your device</span>
                    </li>
                    <li className="flex items-start gap-2" style={{ color: 'var(--text-secondary)' }}>
                      <CheckCircle className="w-4 h-4 mt-0.5 text-success shrink-0" />
                      <span className="text-sm">Retrieved your Claim Token</span>
                    </li>
                  </ul>
                </div>

                <div className="p-4 rounded-lg bg-muted/50 border border-border">
                  <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                    Next Steps
                  </p>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Click "Continue to Register Sensor" below to complete the registration process. You'll need:
                  </p>
                  <ul className="mt-2 space-y-1 ml-4">
                    <li className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      • Your Claim Token (from Serial Monitor)
                    </li>
                    <li className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      • Solana wallet public key
                    </li>
                    <li className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      • Device MAC address
                    </li>
                  </ul>
                </div>

                <div className="p-3 rounded-lg bg-info/10 border border-info/30">
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    💡 Your device will continue collecting and transmitting data. You can now register it to create an on-chain NFT and manage it through the dashboard.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Fixed Action Buttons */}
        <div className="flex flex-col gap-3 pt-4 border-t border-border mt-4">
          <div className="flex gap-3">
            <Button 
              type="button" 
              variant="outline" 
              onClick={handleBack}
              disabled={currentStep === 0}
              className="flex-1 border-border"
            >
              <ChevronLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            
            {currentStep < totalSteps - 1 ? (
              <Button 
                type="button"
                onClick={handleNext}
                disabled={currentStep === 1 && !selectedSensorType}
                className="flex-1 bg-primary text-primary-foreground"
              >
                Next
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button 
                type="button"
                onClick={handleComplete}
                className="flex-1 bg-primary text-primary-foreground"
              >
                Continue to Register Sensor
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            )}
          </div>

          {/* Need Help Link */}
          <div className="text-center">
            <a 
              href="https://docs.sparked-sense.io" 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm hover:underline"
              style={{ color: 'var(--text-secondary)' }}
            >
              <HelpCircle className="w-4 h-4" />
              Need Help?
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}