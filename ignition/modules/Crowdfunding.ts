import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("CrowdfundingModule", (m) => {
  const crowdfunding = m.contract("Crowdfunding");

  return { crowdfunding };
});
