// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./HalomToken.sol"; // Using local import for interface

contract HalomOracle is AccessControl, Pausable {
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant ORACLE_UPDATER_ROLE = keccak256("ORACLE_UPDATER_ROLE");

    IHalomToken public halomToken;
    uint256 public latestHOI;
    uint256 public lastUpdateTime;
    uint256 public nonce;
    uint256 public immutable chainId;

    event HOISet(uint256 newHOI, int256 supplyDelta, uint256 indexed nonce);

    constructor(address _governance, uint256 _chainId) {
        chainId = _chainId;
        _grantRole(DEFAULT_ADMIN_ROLE, _governance);
        _grantRole(GOVERNOR_ROLE, _governance);
        // The ORACLE_UPDATER_ROLE should be granted to a Gnosis Safe multisig wallet.
    }

    function pause() external onlyRole(GOVERNOR_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(GOVERNOR_ROLE) {
        _unpause();
    }

    function setHalomToken(address _halomToken) external onlyRole(GOVERNOR_ROLE) {
        require(_halomToken != address(0), "Zero address");
        halomToken = IHalomToken(_halomToken);
    }
    
    function setHOI(uint256 _hoi, uint256 _nonce) external onlyRole(ORACLE_UPDATER_ROLE) whenNotPaused {
        require(_nonce == nonce, "HalomOracle: Invalid nonce");
        
        // The first rebase is special, as there is no previous HOI value.
        // We use the initial token supply as the basis.
        uint256 S = halomToken.totalSupply();
        int256 supplyDelta;

        if (lastUpdateTime == 0) { // First rebase
            // Assume the peg is 1:1 initially, so calculate the delta from a hypothetical previous HOI of 1*10^9
            uint256 initialPeg = 1e9;
            supplyDelta = int256((_hoi * S) / initialPeg) - int256(S);
        } else {
            supplyDelta = int256((_hoi * S) / latestHOI) - int256(S);
        }
        
        latestHOI = _hoi;
        lastUpdateTime = block.timestamp;
        nonce++;

        halomToken.rebase(supplyDelta);

        emit HOISet(_hoi, supplyDelta, _nonce);
    }
} 