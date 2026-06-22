// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";

contract DonationBadge is ERC721Enumerable {
  using Strings for uint256;

  error InvalidRank();
  error Soulbound();
  error UnauthorizedMinter();
  error ZeroAddress();

  struct Badge {
    address project;
    uint256 rank;
  }

  address public immutable minter;
  mapping(uint256 tokenId => Badge badge) public badges;

  uint256 private _nextTokenId = 1;

  event BadgeMinted(
    uint256 indexed tokenId,
    address indexed recipient,
    address indexed project,
    uint256 rank,
    string tier
  );

  constructor(address minter_) ERC721("Donation Badge", "DONATE") {
    if (minter_ == address(0)) revert ZeroAddress();
    minter = minter_;
  }

  function mint(
    address recipient,
    address project,
    uint256 rank
  ) external returns (uint256 tokenId) {
    if (msg.sender != minter) revert UnauthorizedMinter();
    if (recipient == address(0) || project == address(0)) revert ZeroAddress();

    string memory tier = _tierForRank(rank);
    tokenId = _nextTokenId++;
    badges[tokenId] = Badge({project: project, rank: rank});
    _mint(recipient, tokenId);

    emit BadgeMinted(tokenId, recipient, project, rank, tier);
  }

  function tokenURI(
    uint256 tokenId
  ) public view override returns (string memory) {
    _requireOwned(tokenId);
    Badge storage badge = badges[tokenId];
    string memory tier = _tierForRank(badge.rank);
    string memory medalColor = _colorForRank(badge.rank);
    string memory shortProject = _shortAddress(badge.project);
    string memory image = Base64.encode(
      bytes(
        string.concat(
          '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360" viewBox="0 0 600 360">',
          '<rect width="600" height="360" rx="28" fill="#F4EBD8"/>',
          '<rect x="18" y="18" width="564" height="324" rx="22" fill="none" stroke="#B7A57A" stroke-width="3"/>',
          '<text x="300" y="92" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#4D4535">Donation Badge</text>',
          '<circle cx="300" cy="164" r="70" fill="',
          medalColor,
          '"/>',
          '<text x="300" y="171" text-anchor="middle" font-family="sans-serif" font-size="48" font-weight="bold" fill="#756444">',
          tier,
          "</text>",
          '<text x="300" y="222" text-anchor="middle" font-family="monospace" font-size="24" fill="#4D4535">Rank #',
          badge.rank.toString(),
          "</text>",
          '<text x="300" y="282" text-anchor="middle" font-family="monospace" font-size="20" fill="#756F62">',
          shortProject,
          "</text></svg>"
        )
      )
    );
    string memory json = Base64.encode(
      bytes(
        string.concat(
          '{"name":"MyFundings ',
          tier,
          ' Early Donor Badge","description":"Awarded to the #',
          badge.rank.toString(),
          ' unique contributor","attributes":[{"trait_type":"Project","value":"',
          Strings.toHexString(uint160(badge.project), 20),
          '"},{"trait_type":"Rank","value":',
          badge.rank.toString(),
          '},{"trait_type":"Medal","value":"',
          tier,
          '"}],"image":"data:image/svg+xml;base64,',
          image,
          '"}'
        )
      )
    );
    return string.concat("data:application/json;base64,", json);
  }

  function approve(address, uint256) public pure override(ERC721, IERC721) {
    revert Soulbound();
  }

  function setApprovalForAll(
    address,
    bool
  ) public pure override(ERC721, IERC721) {
    revert Soulbound();
  }

  function _update(
    address to,
    uint256 tokenId,
    address auth
  ) internal override returns (address previousOwner) {
    previousOwner = super._update(to, tokenId, auth);
    if (previousOwner != address(0)) revert Soulbound();
  }

  function _tierForRank(uint256 rank) private pure returns (string memory) {
    if (rank == 1) return "Gold";
    if (rank == 2) return "Silver";
    if (rank == 3) return "Bronze";
    revert InvalidRank();
  }

  function _colorForRank(uint256 rank) private pure returns (string memory) {
    if (rank == 1) return "#D4AF37";
    if (rank == 2) return "#C0C0C0";
    if (rank == 3) return "#CD7F32";
    revert InvalidRank();
  }

  function _shortAddress(address account) private pure returns (string memory) {
    bytes memory full = bytes(Strings.toHexString(uint160(account), 20));
    bytes memory shortened = new bytes(13);
    for (uint256 i; i < 6; ++i) shortened[i] = full[i];
    shortened[6] = ".";
    shortened[7] = ".";
    shortened[8] = ".";
    for (uint256 i; i < 4; ++i) shortened[9 + i] = full[38 + i];
    return string(shortened);
  }
}
