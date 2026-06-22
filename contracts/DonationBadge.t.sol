// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {DonationBadge} from "./DonationBadge.sol";
import {Test} from "forge-std/Test.sol";

contract DonationBadgeTest is Test {
  DonationBadge badge;

  address minter = address(this);
  address alice = address(0xA11CE);
  address bob = address(0xB0B);
  address project = 0x1234567890123456789012345678901234567890;

  event BadgeMinted(
    uint256 indexed tokenId,
    address indexed recipient,
    address indexed project,
    uint256 rank,
    string tier
  );

  function setUp() public {
    badge = new DonationBadge(minter);
  }

  function test_MintStoresMetadataAndUpdatesOwnerEnumeration() public {
    vm.expectEmit(true, true, true, true);
    emit BadgeMinted(1, alice, project, 1, "Gold");

    uint256 tokenId = badge.mint(alice, project, 1);

    (address storedProject, uint256 rank) = badge.badges(tokenId);
    assertEq(tokenId, 1);
    assertEq(storedProject, project);
    assertEq(rank, 1);
    assertEq(badge.ownerOf(tokenId), alice);
    assertEq(badge.balanceOf(alice), 1);
    assertEq(badge.totalSupply(), 1);
    assertEq(badge.tokenByIndex(0), tokenId);
    assertEq(badge.tokenOfOwnerByIndex(alice, 0), tokenId);
  }

  function test_MintUsesIncrementingTokenIds() public {
    assertEq(badge.mint(alice, project, 1), 1);
    assertEq(badge.mint(bob, project, 2), 2);
  }

  function test_OnlyMinterCanMint() public {
    vm.prank(alice);
    vm.expectRevert(DonationBadge.UnauthorizedMinter.selector);
    badge.mint(alice, project, 1);
  }

  function test_MintAssignsAllRankTiers() public {
    uint256 gold = badge.mint(alice, project, 1);
    uint256 silver = badge.mint(alice, project, 2);
    uint256 bronze = badge.mint(alice, project, 3);

    assertTrue(
      _contains(
        _decodedJson(gold),
        '"name":"MyFundings Gold Early Donor Badge"'
      )
    );
    assertTrue(
      _contains(
        _decodedJson(silver),
        '"name":"MyFundings Silver Early Donor Badge"'
      )
    );
    assertTrue(
      _contains(
        _decodedJson(bronze),
        '"name":"MyFundings Bronze Early Donor Badge"'
      )
    );
  }

  function test_MintRejectsRanksOutsideOneToThree() public {
    vm.expectRevert(DonationBadge.InvalidRank.selector);
    badge.mint(alice, project, 0);

    vm.expectRevert(DonationBadge.InvalidRank.selector);
    badge.mint(alice, project, 4);
  }

  function test_ConstructorRejectsZeroMinter() public {
    vm.expectRevert(DonationBadge.ZeroAddress.selector);
    new DonationBadge(address(0));
  }

  function test_MintRejectsZeroRecipient() public {
    vm.expectRevert(DonationBadge.ZeroAddress.selector);
    badge.mint(address(0), project, 1);
  }

  function test_MintRejectsZeroProject() public {
    vm.expectRevert(DonationBadge.ZeroAddress.selector);
    badge.mint(alice, address(0), 1);
  }

  function test_ApproveIsDisabled() public {
    uint256 tokenId = badge.mint(alice, project, 1);

    vm.prank(alice);
    vm.expectRevert(DonationBadge.Soulbound.selector);
    badge.approve(bob, tokenId);
  }

  function test_SetApprovalForAllIsDisabled() public {
    vm.prank(alice);
    vm.expectRevert(DonationBadge.Soulbound.selector);
    badge.setApprovalForAll(bob, true);
  }

  function test_TransferFromIsDisabled() public {
    uint256 tokenId = badge.mint(alice, project, 1);

    vm.prank(alice);
    vm.expectRevert(DonationBadge.Soulbound.selector);
    badge.transferFrom(alice, bob, tokenId);
  }

  function test_SafeTransferFromWithoutDataIsDisabled() public {
    uint256 tokenId = badge.mint(alice, project, 1);

    vm.prank(alice);
    vm.expectRevert(DonationBadge.Soulbound.selector);
    badge.safeTransferFrom(alice, bob, tokenId);
  }

  function test_SafeTransferFromWithDataIsDisabled() public {
    uint256 tokenId = badge.mint(alice, project, 1);

    vm.prank(alice);
    vm.expectRevert(DonationBadge.Soulbound.selector);
    badge.safeTransferFrom(alice, bob, tokenId, hex"cafe");
  }

  function test_TokenUriContainsDecodedOnChainJsonAndSvg() public {
    uint256 tokenId = badge.mint(alice, project, 2);

    string memory json = _decodedJson(tokenId);
    assertTrue(
      _contains(
        json,
        '"name":"MyFundings Silver Early Donor Badge"'
      )
    );
    assertTrue(
      _contains(json, '"description":"Awarded to the #2 unique contributor"')
    );
    assertTrue(
      _contains(
        json,
        '"attributes":[{"trait_type":"Project","value":"0x1234567890123456789012345678901234567890"},{"trait_type":"Rank","value":2},{"trait_type":"Medal","value":"Silver"}]'
      )
    );

    string memory imagePrefix = '"image":"data:image/svg+xml;base64,';
    string memory encodedSvg = _valueUntilQuote(json, imagePrefix);
    string memory svg = string(_decodeBase64(encodedSvg));
    assertTrue(_contains(svg, "0x1234...7890"));
    assertTrue(_contains(svg, "Rank #2"));
    assertTrue(_contains(svg, "Silver"));
  }

  function test_SvgUsesDistinctMedalColorForEveryRank() public {
    uint256 gold = badge.mint(alice, project, 1);
    uint256 silver = badge.mint(alice, project, 2);
    uint256 bronze = badge.mint(alice, project, 3);

    assertTrue(_contains(_decodedSvg(gold), '#D4AF37'));
    assertTrue(_contains(_decodedSvg(silver), '#C0C0C0'));
    assertTrue(_contains(_decodedSvg(bronze), '#CD7F32'));
  }

  function _decodedJson(
    uint256 tokenId
  ) private view returns (string memory) {
    return
      string(
        _decodeBase64AfterPrefix(
          badge.tokenURI(tokenId),
          "data:application/json;base64,"
        )
      );
  }

  function _decodedSvg(uint256 tokenId) private view returns (string memory) {
    string memory json = _decodedJson(tokenId);
    string memory imagePrefix = '"image":"data:image/svg+xml;base64,';
    return string(_decodeBase64(_valueUntilQuote(json, imagePrefix)));
  }

  function _decodeBase64AfterPrefix(
    string memory value,
    string memory prefix
  ) private pure returns (bytes memory) {
    bytes memory raw = bytes(value);
    bytes memory expectedPrefix = bytes(prefix);
    assertGe(raw.length, expectedPrefix.length);
    for (uint256 i; i < expectedPrefix.length; ++i) {
      assertEq(raw[i], expectedPrefix[i]);
    }
    return _decodeBase64(_slice(value, expectedPrefix.length, raw.length));
  }

  function _decodeBase64(
    string memory encoded
  ) private pure returns (bytes memory decoded) {
    bytes memory input = bytes(encoded);
    decoded = new bytes((input.length / 4) * 3);
    uint256 outputLength;
    uint256 buffer;
    uint256 bits;

    for (uint256 i; i < input.length; ++i) {
      if (input[i] == "=") break;
      buffer = (buffer << 6) | _base64Value(input[i]);
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        decoded[outputLength++] = bytes1(uint8(buffer >> bits));
        buffer &= (1 << bits) - 1;
      }
    }

    assembly ("memory-safe") {
      mstore(decoded, outputLength)
    }
  }

  function _base64Value(bytes1 char) private pure returns (uint256) {
    uint8 value = uint8(char);
    if (value >= 65 && value <= 90) return value - 65;
    if (value >= 97 && value <= 122) return value - 71;
    if (value >= 48 && value <= 57) return value + 4;
    if (char == "+") return 62;
    if (char == "/") return 63;
    revert("Invalid base64");
  }

  function _valueUntilQuote(
    string memory value,
    string memory marker
  ) private pure returns (string memory) {
    bytes memory source = bytes(value);
    bytes memory needle = bytes(marker);
    uint256 start = type(uint256).max;

    for (uint256 i; i + needle.length <= source.length; ++i) {
      bool matches = true;
      for (uint256 j; j < needle.length; ++j) {
        if (source[i + j] != needle[j]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        start = i + needle.length;
        break;
      }
    }
    assertNotEq(start, type(uint256).max);

    uint256 end = start;
    while (end < source.length && source[end] != '"') ++end;
    assertLt(end, source.length);
    return _slice(value, start, end);
  }

  function _slice(
    string memory value,
    uint256 start,
    uint256 end
  ) private pure returns (string memory) {
    bytes memory source = bytes(value);
    bytes memory result = new bytes(end - start);
    for (uint256 i; i < result.length; ++i) result[i] = source[start + i];
    return string(result);
  }

  function _contains(
    string memory value,
    string memory needle
  ) private pure returns (bool) {
    bytes memory source = bytes(value);
    bytes memory expected = bytes(needle);
    if (expected.length > source.length) return false;

    for (uint256 i; i + expected.length <= source.length; ++i) {
      bool matches = true;
      for (uint256 j; j < expected.length; ++j) {
        if (source[i + j] != expected[j]) {
          matches = false;
          break;
        }
      }
      if (matches) return true;
    }
    return false;
  }
}
