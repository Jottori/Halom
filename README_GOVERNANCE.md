# Halom Governance System

A Halom protokoll teljes decentralizált governance rendszere, amely tartalmazza a Timelock, DAO, Treasury és fejlesztett orákulum modulokat.

## 🏗️ Architektúra

### 1. Timelock Controller (`HalomTimelock.sol`)
- **Cél**: Időzített végrehajtás minden adminisztratív műveletre
- **Min delay**: 24 óra
- **Biztonság**: Minden kritikus művelet előre bejelentett és várakozási idővel

### 2. Governance (`HalomGovernor.sol`)
- **Szavazati erő**: Negyedik gyök alapú (fourth root)
- **Token lock**: 5 év fix lock period
- **Quorum**: 4% minimum részvétel
- **Voting period**: ~1 hét

### 3. Treasury (`HalomTreasury.sol`)
- **Jutalék elosztás**: 60% staking, 20% LP staking, 20% DAO reserve
- **Automatikus elosztás**: Operator által triggerelt
- **Emergency functions**: Vészhelyzeti pénzügyi műveletek

### 4. Enhanced Oracle (`HalomOracleV2.sol`)
- **Több node**: Konszenzus alapú HOI számítás
- **API integráció**: Valós idejű adatok Eurostat/OECD-ból
- **Validáció**: Median és deviation ellenőrzés

## 🚀 Telepítés

### 1. Függőségek telepítése
```bash
npm install
```

### 2. Environment beállítás
```bash
cp .env.example .env
# Töltsd ki a szükséges értékeket
```

### 3. Governance rendszer telepítése
```bash
npm run deploy:governance
```

### 4. Oracle ütemezés beállítása
```bash
npm run oracle:setup
```

## 📋 Használat

### Governance műveletek

#### 1. Token lock a szavazáshoz
```javascript
// Lock tokens for 5 years to get voting power
await halomGovernor.lockTokens(ethers.parseEther("1000"));
```

#### 2. Proposal létrehozása
```javascript
const targets = [treasuryAddress];
const values = [0];
const calldatas = [
    treasury.interface.encodeFunctionData("updateFeePercentages", [7000, 2000, 1000])
];
const description = "Update fee distribution";

await halomGovernor.propose(targets, values, calldatas, description);
```

#### 3. Szavazás
```javascript
// Vote with locked tokens (fourth root voting power)
await halomGovernor.vote(proposalId, 1); // 1 = For, 0 = Against, 2 = Abstain
```

#### 4. Végrehajtás (timelock után)
```javascript
await halomGovernor.execute(targets, values, calldatas, descriptionHash);
```

### Oracle műveletek

#### 1. Oracle node engedélyezése
```javascript
await halomOracleV2.setOracleAuthorization(oracleAddress, true);
```

#### 2. HOI submission
```javascript
await halomOracleV2.submitHOI(hoiValue);
```

#### 3. Konszenzus ellenőrzése
```javascript
const roundInfo = await halomOracleV2.getCurrentRound();
console.log("Submissions:", roundInfo.submissionCount);
```

### Treasury műveletek

#### 1. Jutalék elosztás
```javascript
await halomTreasury.distributeFees();
```

#### 2. Fee percentages módosítása
```javascript
await halomTreasury.updateFeePercentages(7000, 2000, 1000);
```

## 🔧 Konfiguráció

### Timelock paraméterek
- **Min delay**: 24 óra (konfigurálható)
- **Proposer**: Governor contract
- **Executor**: Governor contract
- **Admin**: Multisig wallet (ajánlott)

### Governance paraméterek
- **Voting delay**: 1 blokk
- **Voting period**: ~1 hét (45818 blokk)
- **Proposal threshold**: 1000 HLM
- **Quorum fraction**: 4%

### Oracle paraméterek
- **Min oracle nodes**: 3
- **Consensus threshold**: 2
- **Max deviation**: 5%
- **Submission window**: 5 perc

## 🧪 Tesztelés

### Biztonsági tesztek futtatása
```bash
npm run test:security
```

### Teljes teszt coverage
```bash
npm run test:coverage
```

### Oracle tesztelés
```bash
npm run oracle:run
```

## 📊 Monitoring

### Log fájlok
- `logs/oracle_updater.log` - Oracle frissítések
- `logs/cron.log` - Ütemezett feladatok

### Health check
```bash
./scripts/monitor_oracle.sh
```

### Alert beállítások
- Email értesítések SMTP-n keresztül
- Slack webhook integráció
- 3 egymást követő hiba után automatikus alert

## 🔐 Biztonság

### Access Control
- **Timelock**: Minden admin művelet időzített
- **Governor**: Csak locked tokenekkel szavazhat
- **Oracle**: Több node konszenzus
- **Treasury**: Emergency pause funkció

### Audit javaslatok
1. **Halborn audit** megrendelése
2. **Bug bounty program** indítása
3. **Formal verification** kritikus funkciókra
4. **Penetration testing** off-chain komponensekre

## 🌐 Mainnet Deployment

### 1. LP Pool létrehozás
```bash
npm run setup:mainnet
```

### 2. Oracle node beállítás
```bash
# Több független oracle node beállítása
# API kulcsok konfigurálása
# Monitoring beállítása
```

### 3. Governance átadás
```bash
# Timelock admin átadása multisig-re
# Oracle node-ok engedélyezése
# Treasury paraméterek beállítása
```

## 📈 Roadmap

### Phase 1: Alapvető Governance ✅
- [x] Timelock Controller
- [x] Governor contract
- [x] Treasury modul
- [x] Enhanced Oracle

### Phase 2: Mainnet Launch
- [ ] LP pool létrehozás
- [ ] Oracle node hálózat
- [ ] Security audit
- [ ] Bug bounty program

### Phase 3: Decentralizáció
- [ ] DAO token distribution
- [ ] Community governance
- [ ] Cross-chain bridges
- [ ] Advanced analytics

## 🤝 Közreműködés

### Fejlesztői útmutató
1. Fork the repository
2. Create feature branch
3. Implement changes
4. Add tests
5. Submit pull request

### Biztonsági jelentések
- Email: security@halom.finance
- Bug bounty: Immunefi platform
- Responsible disclosure policy

## 📞 Kapcsolat

- **Website**: https://halom.finance
- **Discord**: https://discord.gg/halom
- **Twitter**: @HalomFinance
- **GitHub**: https://github.com/halom-finance

## 📄 Licenc

MIT License - lásd a [LICENSE](LICENSE) fájlt. 