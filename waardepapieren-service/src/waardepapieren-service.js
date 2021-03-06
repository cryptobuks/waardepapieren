import * as abundance from '@discipl/abundance-service'
// Specifically importing the server, because the server is not in the index to ensure browser compatibility
import EphemeralServer from '@discipl/core-ephemeral/dist/EphemeralServer'
import { take } from 'rxjs/operators'
import { w3cwebsocket } from 'websocket'

const BRP_UITTREKSEL = 'BRP_UITTREKSEL_NEED'
const BSN_CLAIM_PREDICATE = 'BSN'
const BRP_UITTREKSEL_ACCEPT = 'BRP_UITTREKSEL_ACCEPT'
const AGREE = 'Gewaarmerkt digitaal afschrift van gegevens uit de basisregistratie personen (BRP)'

class WaardenpapierenService {
  async start (nlxOutwayEndpoint, ephemeralEndpoint, ephemeralWebsocketEndpoint) {
    // Setup server
    this.ephemeralServer = new EphemeralServer(3232)
    this.ephemeralServer.start()
    const core = abundance.getCoreAPI()
    const ephemeralConnector = await core.getConnector('ephemeral')
    ephemeralConnector.configure(ephemeralEndpoint, ephemeralWebsocketEndpoint, w3cwebsocket)

    const nlxConnector = await core.getConnector('nlx')
    nlxConnector.configure(nlxOutwayEndpoint)
    let ssid = await abundance.attendTo('ephemeral', BRP_UITTREKSEL)
    let observer = await abundance.observe(ssid.did, 'ephemeral')
    observer.subscribe(async (needClaim) => {
      await this.serveNeed(ssid, needClaim)
    }, (e) => {
      // If connection is dropped by remote peer, this is fine
      if (e.code !== 1006) {
        console.error('Error while listening to need')
        console.error(e)
      }
    })

    return ssid
  }

  async serveNeed (serviceSsid, need) {
    const core = abundance.getCoreAPI()

    let did = need.did

    const observer = await core.observe(did, { [BSN_CLAIM_PREDICATE]: null })

    await observer.pipe(take(1)).subscribe(async (bsnClaim) => {
      const bsn = bsnClaim['claim']['data'][BSN_CLAIM_PREDICATE]
      const nlxConnector = await core.getConnector('nlx')
      let identifier = await nlxConnector.claim(null, { 'path': '/brp/basisregistratie/natuurlijke_personen/bsn/'+bsn, 'params': {}})

      let result = await nlxConnector.get(identifier)

      let personalSsid = await core.newSsid('ephemeral')
      let resultArray = []

      for (let key of Object.keys(result)) {
        resultArray.push({[key]: result[key]})
      }
      let brpClaim = await core.claim(personalSsid, resultArray)
      await abundance.match(personalSsid, did)

      const acceptObserver = await core.observe(did, { [BRP_UITTREKSEL_ACCEPT]: null })

      acceptObserver.pipe(take(1)).subscribe(async (acceptClaim) => {
        let attestationLink = await core.attest(serviceSsid, AGREE, brpClaim)
        await core.attest(personalSsid, AGREE, attestationLink)
      })
    }, (e) => {
      console.error(e)
    })
  }

  async stop () {
    try {
      await this.ephemeralServer.close()
    } catch (e) {
      console.log('Error while closing server')
      console.log(e)
    }
  }

  getCoreAPI () {
    return abundance.getCoreAPI()
  }
}
export { BRP_UITTREKSEL, BSN_CLAIM_PREDICATE, BRP_UITTREKSEL_ACCEPT, AGREE }
export default WaardenpapierenService
