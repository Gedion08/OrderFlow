export type Orderflow = {
  "version": "0.1.0",
  "name": "orderflow",
  "instructions": [
    {
      "name": "createVault",
      "docs": [
        "Create a vault describing the DCA bounds the owner commits to. The vault",
        "PDA is seeded by `(owner, nonce)`; `nonce` is chosen by the owner and",
        "doubles as the on-chain strategy id."
      ],
      "accounts": [
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "mint",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "pool",
          "type": "publicKey"
        },
        {
          "name": "mint",
          "type": "publicKey"
        },
        {
          "name": "side",
          "type": {
            "defined": "SideKind"
          }
        },
        {
          "name": "tranches",
          "type": "u16"
        },
        {
          "name": "intervalSeconds",
          "type": "u64"
        },
        {
          "name": "minBinId",
          "type": "i64"
        },
        {
          "name": "maxBinId",
          "type": "i64"
        },
        {
          "name": "trancheAmount",
          "type": "u64"
        },
        {
          "name": "totalCap",
          "type": "u64"
        }
      ]
    },
    {
      "name": "deposit",
      "docs": [
        "Owner moves `amount` of `mint` into the vault. Repeated deposits allow",
        "topping up a live strategy (total deposit is not locked to `total_cap`)."
      ],
      "accounts": [
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "mint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "ownerAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vaultAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "placeTranche",
      "docs": [
        "Permissionless crank. Places the next tranche of a live strategy as a",
        "DLMM limit order owned by the vault. The program enforces every bound",
        "the owner committed to before invoking DLMM:",
        "",
        "* the strategy must not be cancelled/completed,",
        "* tranches must not be exhausted,",
        "* the cadence (`interval_seconds`) must have elapsed,",
        "* each requested bin must lie inside `[min_bin_id, max_bin_id]`,",
        "* the running placed total must not exceed `total_cap`.",
        "",
        "`bin_array_metas` (the remaining accounts) are the DLMM bin arrays for",
        "`bin_ids`. `bin_ids` is normalized to a fixed-length 50-vector padded",
        "with `i64::MIN` sentinels so the on-chain instruction data is a stable",
        "size regardless of how many bins a crank passes."
      ],
      "accounts": [
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vaultAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "limitOrder",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "validated against the DLMM IDL account order it is passed through to."
          ]
        },
        {
          "name": "crank",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "The crank wallet — pays gas/rent. Never controls funds."
          ]
        },
        {
          "name": "dlmmProgram",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "lbPair",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "binArrayBitmapExtension",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "reserve",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "validated by DLMM."
          ]
        },
        {
          "name": "tokenMint",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "validated by DLMM."
          ]
        },
        {
          "name": "eventAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "binIds",
          "type": {
            "array": [
              "i64",
              50
            ]
          }
        }
      ]
    },
    {
      "name": "claimFees",
      "docs": [
        "Permissionless crank. Claims accrued fees (and returns any remaining",
        "order principal) for a placed limit order; funds return *to the vault*,",
        "never to the crank."
      ],
      "accounts": [
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vaultAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "crank",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "dlmmProgram",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "lbPair",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "binArrayBitmapExtension",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "reserveX",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "reserveY",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenXMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenYMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "limitOrder",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "handler against the stored `pending_limit_order` address."
          ]
        },
        {
          "name": "ownerTokenX",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "ownerTokenY",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "eventAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "memoProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "binIds",
          "type": {
            "vec": "i64"
          }
        }
      ]
    },
    {
      "name": "cancel",
      "docs": [
        "Owner-only. Cancel all open orders for the vault. Remaining funds return",
        "to the vault (still program-controlled); the strategy is marked",
        "cancelled so no further tranches can be placed."
      ],
      "accounts": [
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "withdraw",
      "docs": [
        "Owner-only — always available. Sweeps `amount` from the vault to the",
        "owner. Note this withdraws the settled vault balance; open orders owned",
        "by the vault are untouched (cancel them first to free their funds)."
      ],
      "accounts": [
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "mint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "ownerAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vaultAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "strategyVault",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "publicKey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "pool",
            "type": "publicKey"
          },
          {
            "name": "mint",
            "type": "publicKey"
          },
          {
            "name": "side",
            "type": {
              "defined": "SideKind"
            }
          },
          {
            "name": "tranches",
            "type": "u16"
          },
          {
            "name": "tranchesPlaced",
            "type": "u16"
          },
          {
            "name": "intervalSeconds",
            "type": "u64"
          },
          {
            "name": "minBinId",
            "type": "i64"
          },
          {
            "name": "maxBinId",
            "type": "i64"
          },
          {
            "name": "trancheAmount",
            "type": "u64"
          },
          {
            "name": "totalCap",
            "type": "u64"
          },
          {
            "name": "amountPlaced",
            "type": "u64"
          },
          {
            "name": "lastPlacedAt",
            "type": "i64"
          },
          {
            "name": "pendingLimitOrder",
            "type": {
              "option": {
                "defined": "PendingOrder"
              }
            }
          },
          {
            "name": "status",
            "type": {
              "defined": "VaultStatus"
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ],
  "types": [
    {
      "name": "PendingOrder",
      "docs": [
        "A limit order currently owned by the vault (latest tranche)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "address",
            "type": "publicKey"
          },
          {
            "name": "binIds",
            "type": {
              "vec": "i64"
            }
          }
        ]
      }
    },
    {
      "name": "SideKind",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Bid"
          },
          {
            "name": "Ask"
          }
        ]
      }
    },
    {
      "name": "VaultStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Depositing"
          },
          {
            "name": "Active"
          },
          {
            "name": "Completed"
          },
          {
            "name": "Cancelled"
          }
        ]
      }
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "InvalidBounds",
      "msg": "Invalid strategy bounds"
    },
    {
      "code": 6001,
      "name": "BracketTooWide",
      "msg": "Price bracket is wider than the 50-bin DLMM limit-order limit"
    },
    {
      "code": 6002,
      "name": "InvalidCap",
      "msg": "Total cap must be >= tranche amount"
    },
    {
      "code": 6003,
      "name": "ZeroAmount",
      "msg": "Deposit amount must be greater than zero"
    },
    {
      "code": 6004,
      "name": "NotPlaceable",
      "msg": "Strategy is not in a state that allows placing tranches"
    },
    {
      "code": 6005,
      "name": "AllTranchesPlaced",
      "msg": "All configured tranches have already been placed"
    },
    {
      "code": 6006,
      "name": "CadenceNotMet",
      "msg": "The tranche cadence (interval) has not elapsed"
    },
    {
      "code": 6007,
      "name": "NoBins",
      "msg": "No bin ids were provided"
    },
    {
      "code": 6008,
      "name": "TooManyBins",
      "msg": "More than 50 bins requested"
    },
    {
      "code": 6009,
      "name": "BinOutOfBracket",
      "msg": "A requested bin lies outside the owner's price bracket"
    },
    {
      "code": 6010,
      "name": "CapExceeded",
      "msg": "Placing this tranche would exceed the total cap"
    },
    {
      "code": 6011,
      "name": "WrongLimitOrder",
      "msg": "Limit-order PDA does not match the derived address"
    },
    {
      "code": 6012,
      "name": "MintMismatch",
      "msg": "Token mint does not match the vault's deposited mint"
    }
  ]
};

export const IDL: Orderflow = {
  "version": "0.1.0",
  "name": "orderflow",
  "instructions": [
    {
      "name": "createVault",
      "docs": [
        "Create a vault describing the DCA bounds the owner commits to. The vault",
        "PDA is seeded by `(owner, nonce)`; `nonce` is chosen by the owner and",
        "doubles as the on-chain strategy id."
      ],
      "accounts": [
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "mint",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "pool",
          "type": "publicKey"
        },
        {
          "name": "mint",
          "type": "publicKey"
        },
        {
          "name": "side",
          "type": {
            "defined": "SideKind"
          }
        },
        {
          "name": "tranches",
          "type": "u16"
        },
        {
          "name": "intervalSeconds",
          "type": "u64"
        },
        {
          "name": "minBinId",
          "type": "i64"
        },
        {
          "name": "maxBinId",
          "type": "i64"
        },
        {
          "name": "trancheAmount",
          "type": "u64"
        },
        {
          "name": "totalCap",
          "type": "u64"
        }
      ]
    },
    {
      "name": "deposit",
      "docs": [
        "Owner moves `amount` of `mint` into the vault. Repeated deposits allow",
        "topping up a live strategy (total deposit is not locked to `total_cap`)."
      ],
      "accounts": [
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "mint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "ownerAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vaultAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "placeTranche",
      "docs": [
        "Permissionless crank. Places the next tranche of a live strategy as a",
        "DLMM limit order owned by the vault. The program enforces every bound",
        "the owner committed to before invoking DLMM:",
        "",
        "* the strategy must not be cancelled/completed,",
        "* tranches must not be exhausted,",
        "* the cadence (`interval_seconds`) must have elapsed,",
        "* each requested bin must lie inside `[min_bin_id, max_bin_id]`,",
        "* the running placed total must not exceed `total_cap`.",
        "",
        "`bin_array_metas` (the remaining accounts) are the DLMM bin arrays for",
        "`bin_ids`. `bin_ids` is normalized to a fixed-length 50-vector padded",
        "with `i64::MIN` sentinels so the on-chain instruction data is a stable",
        "size regardless of how many bins a crank passes."
      ],
      "accounts": [
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vaultAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "limitOrder",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "validated against the DLMM IDL account order it is passed through to."
          ]
        },
        {
          "name": "crank",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "The crank wallet — pays gas/rent. Never controls funds."
          ]
        },
        {
          "name": "dlmmProgram",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "lbPair",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "binArrayBitmapExtension",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "reserve",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "validated by DLMM."
          ]
        },
        {
          "name": "tokenMint",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "validated by DLMM."
          ]
        },
        {
          "name": "eventAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "binIds",
          "type": {
            "array": [
              "i64",
              50
            ]
          }
        }
      ]
    },
    {
      "name": "claimFees",
      "docs": [
        "Permissionless crank. Claims accrued fees (and returns any remaining",
        "order principal) for a placed limit order; funds return *to the vault*,",
        "never to the crank."
      ],
      "accounts": [
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vaultAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "crank",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "dlmmProgram",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "lbPair",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "binArrayBitmapExtension",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "reserveX",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "reserveY",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenXMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenYMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "limitOrder",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "handler against the stored `pending_limit_order` address."
          ]
        },
        {
          "name": "ownerTokenX",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "ownerTokenY",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "eventAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "memoProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "binIds",
          "type": {
            "vec": "i64"
          }
        }
      ]
    },
    {
      "name": "cancel",
      "docs": [
        "Owner-only. Cancel all open orders for the vault. Remaining funds return",
        "to the vault (still program-controlled); the strategy is marked",
        "cancelled so no further tranches can be placed."
      ],
      "accounts": [
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "withdraw",
      "docs": [
        "Owner-only — always available. Sweeps `amount` from the vault to the",
        "owner. Note this withdraws the settled vault balance; open orders owned",
        "by the vault are untouched (cancel them first to free their funds)."
      ],
      "accounts": [
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "mint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "ownerAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vaultAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "strategyVault",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "publicKey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "pool",
            "type": "publicKey"
          },
          {
            "name": "mint",
            "type": "publicKey"
          },
          {
            "name": "side",
            "type": {
              "defined": "SideKind"
            }
          },
          {
            "name": "tranches",
            "type": "u16"
          },
          {
            "name": "tranchesPlaced",
            "type": "u16"
          },
          {
            "name": "intervalSeconds",
            "type": "u64"
          },
          {
            "name": "minBinId",
            "type": "i64"
          },
          {
            "name": "maxBinId",
            "type": "i64"
          },
          {
            "name": "trancheAmount",
            "type": "u64"
          },
          {
            "name": "totalCap",
            "type": "u64"
          },
          {
            "name": "amountPlaced",
            "type": "u64"
          },
          {
            "name": "lastPlacedAt",
            "type": "i64"
          },
          {
            "name": "pendingLimitOrder",
            "type": {
              "option": {
                "defined": "PendingOrder"
              }
            }
          },
          {
            "name": "status",
            "type": {
              "defined": "VaultStatus"
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ],
  "types": [
    {
      "name": "PendingOrder",
      "docs": [
        "A limit order currently owned by the vault (latest tranche)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "address",
            "type": "publicKey"
          },
          {
            "name": "binIds",
            "type": {
              "vec": "i64"
            }
          }
        ]
      }
    },
    {
      "name": "SideKind",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Bid"
          },
          {
            "name": "Ask"
          }
        ]
      }
    },
    {
      "name": "VaultStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Depositing"
          },
          {
            "name": "Active"
          },
          {
            "name": "Completed"
          },
          {
            "name": "Cancelled"
          }
        ]
      }
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "InvalidBounds",
      "msg": "Invalid strategy bounds"
    },
    {
      "code": 6001,
      "name": "BracketTooWide",
      "msg": "Price bracket is wider than the 50-bin DLMM limit-order limit"
    },
    {
      "code": 6002,
      "name": "InvalidCap",
      "msg": "Total cap must be >= tranche amount"
    },
    {
      "code": 6003,
      "name": "ZeroAmount",
      "msg": "Deposit amount must be greater than zero"
    },
    {
      "code": 6004,
      "name": "NotPlaceable",
      "msg": "Strategy is not in a state that allows placing tranches"
    },
    {
      "code": 6005,
      "name": "AllTranchesPlaced",
      "msg": "All configured tranches have already been placed"
    },
    {
      "code": 6006,
      "name": "CadenceNotMet",
      "msg": "The tranche cadence (interval) has not elapsed"
    },
    {
      "code": 6007,
      "name": "NoBins",
      "msg": "No bin ids were provided"
    },
    {
      "code": 6008,
      "name": "TooManyBins",
      "msg": "More than 50 bins requested"
    },
    {
      "code": 6009,
      "name": "BinOutOfBracket",
      "msg": "A requested bin lies outside the owner's price bracket"
    },
    {
      "code": 6010,
      "name": "CapExceeded",
      "msg": "Placing this tranche would exceed the total cap"
    },
    {
      "code": 6011,
      "name": "WrongLimitOrder",
      "msg": "Limit-order PDA does not match the derived address"
    },
    {
      "code": 6012,
      "name": "MintMismatch",
      "msg": "Token mint does not match the vault's deposited mint"
    }
  ]
};
