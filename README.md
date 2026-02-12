# Rental Disputes Agent

A Google ADK-powered agent that performs preliminary validation of rental dispute cases to determine if they satisfy legislative legal requirements before entering the formal legal process.

## Features

- **Bilingual Support**: User selects Arabic or English at start
- **Conversational Validation Flow**:
   - Language selection
   - Role identification (Landlord/Tenant)
   - Document collection (contract, claim, supporting docs)
   - Clarifications to apply the law
   - Final decision with law references

## Prerequisites

- Node.js 24.13.0 or later
- npm 11.8.0 or later
- Google Gemini API Key ([Get one here](https://aistudio.google.com/app/apikey))

## Installation

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file and add your Gemini API key:
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` and replace `your_gemini_api_key_here` with your actual API key.

## Usage

### Run with Web Interface (Recommended)

```bash
npm run dev
```

Then open your browser to http://localhost:8000

### Run with Command-Line Interface

```bash
npm start
```

## How It Works

1. **Language Selection**: Choose English or Arabic
2. **Role Identification**: Landlord or Tenant
3. **Document Collection**: Provide rental contract, statement of claim, and any supporting documents
4. **Clarifications**: The agent asks for any missing details needed to apply the law
5. **Decision**: Receive one of three outcomes with legal references:
   - ✅ **Valid Claim**
   - ⚠️ **Invalid Claim**
   - ❌ **Unable to Decide**

## Important Disclaimers

⚖️ This agent is **advisory and non-binding**:
- It does **NOT** provide legal opinions
- It does **NOT** predict court outcomes
- Results are for informational purposes only
- Always consult with a qualified legal professional

## Language Support

The agent uses the language you select at the start:
- 🇸🇦 Arabic
- 🇬🇧 English

## Project Structure

```
rental-disputes-agent/
├── agent.ts                    # Main conversational agent
├── Law/                         # Ajman Tenancy Law (JSON)
│   ├── Rental Law (en).json
│   └── Rental Law (ar).json
├── tools/                      # Custom tools
│   └── documentProcessing.ts
├── utils/                      # Utility functions
│   └── lawReferences.ts
├── package.json
├── tsconfig.json
└── README.md
```

## License

ISC
