#!/usr/bin/env npx tsx
/**
 * Originate the Aleatory platform contracts.
 *
 *   python3 contract/build.py
 *   npx tsx contract/deploy.ts [--dry-run] [--network shadownet|mainnet]
 *                              [--only resolver|provider|registry|factory|marketplace]
 *
 * Order matters: the factory needs the resolver's address, so the resolver
 * goes first. Everything else is independent. Addresses are written to
 * `contract/deployments/<network>.json` and reused on later runs, so a
 * partial deploy resumes where it stopped.
 *
 * Env:
 *   TEZOS_WALLET_PRIV_KEY     deployer (signs + pays)
 *   ALEA_ADMIN_ADDRESS        administrator of resolver/factory/marketplace
 *                             (default: the deployer)
 *   ALEA_TREASURY_ADDRESS     where marketplace fees sweep to
 *   ALEA_AGENT_ADDRESS        our render daemon's signing key
 *   ALEA_MARKET_FEE_BPS       secondary fee, basis points (default 250 = 2.5%)
 *   ALEA_DEPLOY_PRICE_MUTEZ   factory deploy fee (default 0, see decisions.md §2)
 *
 * The factory embeds its own collection template, so its code is the largest
 * thing here, and a Tezos operation is capped at 32,768 bytes. If the factory
 * will not originate, the fix is architectural, and this script says so in
 * those words.
 */
import 'dotenv/config'
import { TezosToolkit, MichelsonMap } from '@taquito/taquito'
import { InMemorySigner } from '@taquito/signer'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BUILD_DIR = resolve(__dirname, 'build')
const DEPLOY_DIR = resolve(__dirname, 'deployments')

const networkArg = process.argv.find((_a, i) => process.argv[i - 1] === '--network')
const NETWORK = networkArg || process.env.TEZOS_NETWORK || 'shadownet'
if (NETWORK !== 'shadownet' && NETWORK !== 'mainnet') {
  console.error(`Unknown --network "${NETWORK}".`)
  process.exit(1)
}
const onlyArg = process.argv.find((_a, i) => process.argv[i - 1] === '--only')
const DRY_RUN = process.argv.includes('--dry-run')

const DEFAULT_RPC: Record<string, string> = {
  shadownet: 'https://rpc.tzkt.io/shadownet',
  mainnet: 'https://rpc.tzkt.io/mainnet',
}
const TZKT: Record<string, string> = { shadownet: 'shadownet.tzkt.io', mainnet: 'tzkt.io' }
const RPC_URL = process.env.TEZOS_RPC || DEFAULT_RPC[NETWORK]

/** Tezos caps a single operation at 32,768 bytes, code included. */
const MAX_OPERATION_BYTES = 32768

/**
 * Chain limits, read live.
 *
 * On shadownet `hard_gas_limit_per_operation` equals
 * `hard_gas_limit_per_block`, so an operation submitted at the per-operation
 * maximum consumes the entire block budget and the node rejects it with
 * `gas_exhausted.block`. Taquito's estimator simulates at that maximum, which
 * is why estimation fails there on contracts of any size.
 *
 * Reading both and staying under the block ceiling is what makes an
 * origination land.
 */
interface ChainLimits {
  gasPerOperation: number
  gasPerBlock: number
  storagePerOperation: number
  costPerByte: number
}

async function chainLimits(tezos: TezosToolkit): Promise<ChainLimits> {
  const c = (await tezos.rpc.getConstants()) as unknown as {
    hard_gas_limit_per_operation: { toNumber(): number }
    hard_gas_limit_per_block: { toNumber(): number }
    hard_storage_limit_per_operation: { toNumber(): number }
    cost_per_byte: { toNumber(): number }
  }
  return {
    gasPerOperation: c.hard_gas_limit_per_operation.toNumber(),
    gasPerBlock: c.hard_gas_limit_per_block.toNumber(),
    storagePerOperation: c.hard_storage_limit_per_operation.toNumber(),
    costPerByte: c.cost_per_byte.toNumber(),
  }
}

/**
 * Limits to submit with when estimation is unavailable.
 *
 * Well under the block ceiling, since the operation has to fit inside a block
 * alongside whatever else is in it.
 */
function fallbackLimits(limits: ChainLimits) {
  const ceiling = Math.min(limits.gasPerOperation, limits.gasPerBlock)
  return {
    gasLimit: Math.floor(ceiling * 0.75),
    storageLimit: limits.storagePerOperation,
    fee: 100_000,
  }
}

type Name = 'resolver' | 'provider' | 'registry' | 'factory' | 'marketplace'

const CONTRACT_DIR: Record<Name, string> = {
  resolver: 'AleatoryResolver',
  provider: 'AleatoryProvider',
  registry: 'AleatoryRegistry',
  factory: 'AleatoryFactory',
  marketplace: 'AleatoryMarketplace',
}

/** Dependency order. The factory needs the resolver's address. */
const ORDER: Name[] = ['resolver', 'provider', 'registry', 'marketplace', 'factory']

function loadCode(name: Name): unknown {
  const p = resolve(BUILD_DIR, CONTRACT_DIR[name], 'step_001_cont_0_contract.json')
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    throw new Error(
      `No compiled code at ${p}\n  Run: python3 contract/build.py`,
    )
  }
}

/** TZIP-16 metadata pointing at an inline JSON document. */
function tzip16(doc: Record<string, unknown>): MichelsonMap<string, string> {
  const m = new MichelsonMap<string, string>()
  const hex = (s: string) => Buffer.from(s, 'utf-8').toString('hex')
  m.set('', hex('tezos-storage:content'))
  m.set('content', hex(JSON.stringify(doc)))
  return m
}

function meta(name: string, description: string) {
  return tzip16({
    name,
    description,
    version: '0.1.0',
    homepage: 'https://github.com/skullzarmy/aleatory',
    interfaces: ['TZIP-012', 'TZIP-016'],
  })
}

type Record_ = Record<string, unknown>

function readDeployments(): Record<string, string> {
  const p = resolve(DEPLOY_DIR, `${NETWORK}.json`)
  if (!existsSync(p)) return {}
  return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, string>
}

function writeDeployments(d: Record<string, string>) {
  mkdirSync(DEPLOY_DIR, { recursive: true })
  writeFileSync(resolve(DEPLOY_DIR, `${NETWORK}.json`), JSON.stringify(d, null, 2) + '\n')
}

async function ensureRevealed(tezos: TezosToolkit, signer: InMemorySigner) {
  const pkh = await signer.publicKeyHash()
  if (await tezos.rpc.getManagerKey(pkh).catch(() => null)) return
  // Reveal separately, never bundled: on shadownet the per-operation gas cap
  // equals the per-block cap, so a reveal riding along with an origination
  // this size overflows and the whole batch fails.
  console.log('\nRevealing deployer key (one-time)...')
  const branch = (await tezos.rpc.getBlockHeader()).hash
  const protocol = (await tezos.rpc.getProtocols()).protocol
  const counter = parseInt((await tezos.rpc.getContract(pkh)).counter ?? '0', 10)
  const contents = [
    {
      kind: 'reveal',
      source: pkh,
      fee: '1000',
      counter: String(counter + 1),
      gas_limit: '5000',
      storage_limit: '0',
      public_key: await signer.publicKey(),
    },
  ]
  const forged = await tezos.rpc.forgeOperations({ branch, contents } as never)
  const sig = await signer.sign(forged, new Uint8Array([3]))
  await tezos.rpc.preapplyOperations([
    { branch, contents, protocol, signature: sig.prefixSig },
  ] as never)
  const opHash = await tezos.rpc.injectOperation(sig.sbytes)
  console.log(`  Reveal injected: ${opHash}, waiting...`)
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 4000))
    if (await tezos.rpc.getManagerKey(pkh).catch(() => null)) {
      console.log('  Revealed.')
      return
    }
  }
  throw new Error(`Reveal not confirmed (op ${opHash}).`)
}

async function main() {
  const secretKey = process.env.TEZOS_WALLET_PRIV_KEY
  if (!secretKey || !/^(edsk|spsk|p2sk)/.test(secretKey)) {
    console.error('Set TEZOS_WALLET_PRIV_KEY.')
    process.exit(1)
  }
  const tezos = new TezosToolkit(RPC_URL)
  const signer = await InMemorySigner.fromSecretKey(secretKey)
  tezos.setSignerProvider(signer)
  const deployer = await signer.publicKeyHash()

  const admin = process.env.ALEA_ADMIN_ADDRESS || deployer
  const treasury = process.env.ALEA_TREASURY_ADDRESS || admin
  const agent = process.env.ALEA_AGENT_ADDRESS || deployer
  const feeBps = parseInt(process.env.ALEA_MARKET_FEE_BPS || '250', 10)
  const deployPrice = parseInt(process.env.ALEA_DEPLOY_PRICE_MUTEZ || '0', 10)

  // A mainnet run with a shadownet .env, or the reverse, bakes the wrong
  // addresses in permanently, and nothing on chain catches it.
  const envNetwork = process.env.PUBLIC_TEZOS_NETWORK
  if (envNetwork && envNetwork !== NETWORK) {
    console.error(`\n✗ REFUSING: --network ${NETWORK} but PUBLIC_TEZOS_NETWORK=${envNetwork}.`)
    process.exit(1)
  }
  if (feeBps > 1000) {
    console.error(`\n✗ REFUSING: ALEA_MARKET_FEE_BPS=${feeBps} exceeds the contract's own 10% ceiling.`)
    process.exit(1)
  }

  console.log(`\nAleatory deploy`)
  console.log(`  network   ${NETWORK}  (${RPC_URL})`)
  console.log(`  deployer  ${deployer}`)
  console.log(`  admin     ${admin}`)
  console.log(`  treasury  ${treasury}`)
  console.log(`  agent     ${agent}`)
  console.log(`  fee       ${feeBps} bps      deploy price ${deployPrice} mutez`)
  if (DRY_RUN) console.log(`  DRY RUN, estimating only, nothing will be injected`)

  const deployed = readDeployments()
  const targets = onlyArg ? [onlyArg as Name] : ORDER
  for (const t of targets) {
    if (!ORDER.includes(t)) {
      console.error(`Unknown --only "${t}". One of: ${ORDER.join(', ')}`)
      process.exit(1)
    }
  }

  const storageFor = (name: Name): Record_ => {
    switch (name) {
      case 'resolver':
        return { administrator: admin, proposed_admin: null, writers: [agent] }
      case 'provider':
        return {
          operator: admin,
          agent,
          render_gas: 0,
          metadata: meta('Aleatory Render', 'Reference render provider.'),
        }
      case 'registry':
        return { providers: new MichelsonMap(), count: 0 }
      case 'marketplace':
        return {
          administrator: admin,
          proposed_admin: null,
          paused: false,
          fee_bps: feeBps,
          treasury,
          fees_accrued: 0,
          listings: new MichelsonMap(),
          next_listing_id: 0,
          offers: new MichelsonMap(),
          next_offer_id: 0,
          metadata: meta('Aleatory Marketplace', 'Secondary market for Aleatory pieces.'),
        }
      case 'factory': {
        const resolverAddress = deployed.resolver
        if (!resolverAddress) {
          throw new Error('The factory needs a resolver. Deploy that first, or pass --only resolver.')
        }
        return {
          administrator: admin,
          proposed_admin: null,
          paused: false,
          deploy_price: deployPrice,
          treasury,
          fees_accrued: 0,
          resolver: resolverAddress,
          collections: new MichelsonMap(),
          next_collection_id: 0,
        }
      }
    }
  }

  const limits = await chainLimits(tezos)
  console.log(
    `  gas caps  ${limits.gasPerOperation} per op, ${limits.gasPerBlock} per block`,
  )

  if (!DRY_RUN) await ensureRevealed(tezos, signer)

  for (const name of targets) {
    if (deployed[name]) {
      console.log(`\n${name}: already at ${deployed[name]}, skipping`)
      continue
    }
    const code = loadCode(name)
    const codeBytes = JSON.stringify(code).length
    console.log(`\n${name}`)
    console.log(`  micheline json  ${codeBytes.toLocaleString()} bytes`)

    let explicit: { gasLimit: number; storageLimit: number; fee: number } | null = null
    try {
      const estimate = await tezos.estimate.originate({
        code: code as never,
        storage: storageFor(name),
      })
      console.log(
        `  storage burn    ${(estimate.burnFeeMutez / 1_000_000).toFixed(6)} tez  (${estimate.storageLimit} bytes)`,
      )
      console.log(`  gas             ${estimate.gasLimit}`)
      console.log(`  total cost      ${(estimate.totalCost / 1_000_000).toFixed(6)} tez`)
      if (estimate.opSize && estimate.opSize > MAX_OPERATION_BYTES) {
        console.error(`  ✗ operation is ${estimate.opSize} bytes, over the ${MAX_OPERATION_BYTES} cap`)
        process.exit(1)
      }
    } catch (e) {
      const msg = String(e)
      if (msg.match(/operation.*too large|too_large|size/i)) {
        console.error(`  ✗ ${(e as Error).message}`)
        console.error(
          `\n  This is the ${MAX_OPERATION_BYTES}-byte operation cap. ${name} cannot be\n` +
            `  originated as one operation, and the fix is architectural.`,
        )
        process.exit(1)
      }
      if (msg.match(/gas_exhausted|gas_limit_too_high/i)) {
        // The estimator simulates at the per-operation maximum, which on this
        // chain is the whole block. Submit explicit limits instead.
        explicit = fallbackLimits(limits)
        console.log(
          `  estimation unavailable on ${NETWORK} (gas caps are equal), submitting explicit limits`,
        )
        console.log(`  gas             ${explicit.gasLimit}`)
        console.log(`  storage limit   ${explicit.storageLimit} bytes`)
        console.log(
          `  burn ceiling    ${((explicit.storageLimit * limits.costPerByte) / 1_000_000).toFixed(6)} tez  (actual is charged on what is used)`,
        )
      } else {
        console.error(`  ✗ ${(e as Error).message}`)
        process.exit(1)
      }
    }

    if (DRY_RUN) continue

    const op = await tezos.contract.originate({
      code: code as never,
      storage: storageFor(name),
      ...(explicit ?? {}),
    })
    console.log(`  injected ${op.hash}, confirming...`)
    const contract = await op.contract()
    // What it actually cost, read from the receipt.
    console.log(
      `  cost            ${((op.fee + (op.storageDiff ?? 0) * limits.costPerByte) / 1_000_000).toFixed(6)} tez` +
        `  (fee ${op.fee}, storage ${op.storageDiff ?? 0} bytes)`,
    )
    deployed[name] = contract.address
    writeDeployments(deployed)
    console.log(`  ✓ ${contract.address}`)
    console.log(`    https://${TZKT[NETWORK]}/${contract.address}`)
  }

  console.log(`\nDeployments (${NETWORK}):`)
  for (const [k, v] of Object.entries(deployed)) console.log(`  ${k.padEnd(12)} ${v}`)
  if (!DRY_RUN) console.log(`\nWritten to contract/deployments/${NETWORK}.json`)
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`)
  process.exit(1)
})
